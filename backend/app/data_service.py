from __future__ import annotations

import io
import json
import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from .models import Dataset, SaleRecord

ROOT_DIR = Path(__file__).resolve().parents[2]
DEMO_PATH = ROOT_DIR / "data" / "demo_sales.csv"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

FIELDS = [
    "date", "revenue", "quantity", "unit_price", "profit", "cost", "discount",
    "order_id", "customer", "product", "category", "region", "channel",
]
REQUIRED = {"date": True, "revenue": True}
ALIASES: dict[str, list[str]] = {
    "date": ["date", "order date", "order_date", "transaction date", "invoice date", "purchase date", "created at", "timestamp", "day"],
    "revenue": ["revenue", "sales", "total sales", "sales amount", "total amount", "amount", "net sales", "gross sales", "order value", "line total", "total revenue"],
    "quantity": ["quantity", "qty", "units", "units sold", "items sold", "order quantity"],
    "unit_price": ["unit price", "unit_price", "price", "selling price", "item price", "rate", "average price"],
    "profit": ["profit", "net profit", "gross profit", "earnings", "profit amount"],
    "cost": ["cost", "cogs", "cost of goods", "total cost", "product cost"],
    "discount": ["discount", "discount rate", "discount percent", "discount %", "discount_pct"],
    "order_id": ["order id", "order_id", "order number", "invoice", "invoice no", "invoice number", "transaction id", "transaction_id", "id", "order"],
    "customer": ["customer", "customer name", "customer id", "client", "buyer", "customer_name"],
    "product": ["product", "product name", "item", "item name", "sku name", "product_name"],
    "category": ["category", "product category", "product line", "department", "segment", "product type"],
    "region": ["region", "state", "city", "country", "market", "territory", "province", "sales region"],
    "channel": ["channel", "sales channel", "platform", "source", "order channel", "marketplace"],
}


def clean_column_name(name: Any) -> str:
    text = str(name).strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def guess_mapping(columns: list[str]) -> dict[str, str]:
    normalized = {col: clean_column_name(col) for col in columns}
    result: dict[str, str] = {}
    used: set[str] = set()
    for field, aliases in ALIASES.items():
        # Exact header aliases first, then safe contains matches for verbose business headers.
        candidates = [col for col, clean in normalized.items() if clean in aliases and col not in used]
        if not candidates:
            candidates = [
                col for col, clean in normalized.items()
                if col not in used and any(len(alias) >= 5 and (clean.startswith(alias + " ") or clean.endswith(" " + alias)) for alias in aliases)
            ]
        if candidates:
            result[field] = candidates[0]
            used.add(candidates[0])
    return result


def read_dataframe(data: bytes, filename: str) -> pd.DataFrame:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".csv", ".xlsx", ".xls"}:
        raise HTTPException(status_code=415, detail="Use a CSV, XLSX or XLS file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 20 MB. Try a smaller export.")
    try:
        if suffix == ".csv":
            try:
                frame = pd.read_csv(io.BytesIO(data), encoding="utf-8-sig")
            except UnicodeDecodeError:
                frame = pd.read_csv(io.BytesIO(data), encoding="latin-1")
        else:
            frame = pd.read_excel(io.BytesIO(data), engine="openpyxl" if suffix == ".xlsx" else "xlrd")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"We could not read this file: {exc}") from exc
    if frame.empty:
        raise HTTPException(status_code=422, detail="The selected file has no data rows.")
    if len(frame.columns) < 1:
        raise HTTPException(status_code=422, detail="No column headers were found in this file.")
    # Duplicate/blank headers make mapping ambiguous; keep columns stable and human-readable.
    columns: list[str] = []
    used: dict[str, int] = {}
    for idx, raw in enumerate(frame.columns):
        base = str(raw).strip() or f"Column {idx + 1}"
        used[base] = used.get(base, 0) + 1
        columns.append(base if used[base] == 1 else f"{base} ({used[base]})")
    frame.columns = columns
    return frame


def _numeric(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.replace(r"[₹$€£,\s]", "", regex=True).str.replace("%", "", regex=False)
    cleaned = cleaned.replace({"": None, "nan": None, "None": None, "-": None, "—": None})
    return pd.to_numeric(cleaned, errors="coerce")


def normalize_sales(frame: pd.DataFrame, mapping: dict[str, str]) -> tuple[pd.DataFrame, list[str], int]:
    if not mapping.get("date") or mapping["date"] not in frame.columns:
        raise HTTPException(status_code=422, detail="Map an order date column before submitting the file.")
    revenue_col = mapping.get("revenue")
    qty_col = mapping.get("quantity")
    price_col = mapping.get("unit_price")
    if (not revenue_col or revenue_col not in frame.columns) and not (qty_col in frame.columns and price_col in frame.columns):
        raise HTTPException(status_code=422, detail="Choose a sales/revenue column, or map both quantity and unit price.")

    output = pd.DataFrame(index=frame.index)
    output["order_date"] = pd.to_datetime(frame[mapping["date"]], errors="coerce", dayfirst=False).dt.date
    for field in ["quantity", "unit_price", "revenue", "profit", "cost", "discount"]:
        col = mapping.get(field)
        output[field] = _numeric(frame[col]) if col and col in frame.columns else pd.NA
    if not revenue_col or revenue_col not in frame.columns:
        output["revenue"] = output["quantity"] * output["unit_price"]
    output["revenue"] = pd.to_numeric(output["revenue"], errors="coerce")
    output["quantity"] = pd.to_numeric(output["quantity"], errors="coerce")
    output["unit_price"] = pd.to_numeric(output["unit_price"], errors="coerce")
    output["profit"] = pd.to_numeric(output["profit"], errors="coerce")
    output["cost"] = pd.to_numeric(output["cost"], errors="coerce")
    output["discount"] = pd.to_numeric(output["discount"], errors="coerce")
    if "cost" in output and output["cost"].notna().any():
        derived_profit = output["revenue"] - output["cost"]
        output["profit"] = output["profit"].where(output["profit"].notna(), derived_profit)
    if "profit" in output and output["profit"].notna().any():
        derived_cost = output["revenue"] - output["profit"]
        output["cost"] = output["cost"].where(output["cost"].notna(), derived_cost)

    text_fields = {"order_id": "order_id", "customer": "customer", "product": "product", "category": "category", "region": "region", "channel": "channel"}
    fallbacks = {"order_id": None, "customer": None, "product": "Unspecified product", "category": "Uncategorised", "region": "Unspecified", "channel": "Unspecified"}
    for field, target in text_fields.items():
        col = mapping.get(field)
        if col and col in frame.columns:
            values = frame[col].astype("string").str.strip()
            output[target] = values.mask(values.isna() | values.eq(""), fallbacks[field])
        else:
            output[target] = fallbacks[field]

    original_count = len(output)
    valid = output["order_date"].notna() & output["revenue"].notna() & output["revenue"].map(lambda x: pd.notna(x) and math.isfinite(float(x)))
    output = output.loc[valid].copy()
    output = output[output["revenue"] >= 0]
    dropped = original_count - len(output)
    if output.empty:
        raise HTTPException(status_code=422, detail="No usable rows found. Check your date and sales column mapping.")
    output = output.reset_index(drop=True)
    output["source_row"] = output.index + 2
    # Keep standardized columns in the database; source-specific extras stay in the original file.
    output["raw_values"] = [{} for _ in output.index.tolist()]
    return output, [], dropped


def _safe_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    val = float(value)
    return val if math.isfinite(val) else None


def persist_dataset(
    db: Session,
    frame: pd.DataFrame,
    mapping: dict[str, str],
    name: str,
    source: str,
    currency: str = "INR",
    is_demo: bool = False,
) -> Dataset:
    normalized, _, dropped = normalize_sales(frame, mapping)
    dataset = Dataset(
        name=name[:180], source=source, row_count=len(normalized), currency=currency.upper()[:8],
        is_demo=is_demo, date_min=str(min(normalized["order_date"])), date_max=str(max(normalized["order_date"])),
        fields_json={"mapping": mapping, "dropped_rows": dropped},
    )
    db.add(dataset)
    db.flush()
    records: list[SaleRecord] = []
    for _, row in normalized.iterrows():
        records.append(SaleRecord(
            dataset_id=dataset.id,
            source_row=int(row.get("source_row", 0)),
            order_date=row["order_date"],
            order_id=_str_or_none(row.get("order_id")),
            customer=_str_or_none(row.get("customer")),
            product=_fallback(row.get("product"), "Unspecified product"),
            category=_fallback(row.get("category"), "Uncategorised"),
            region=_fallback(row.get("region"), "Unspecified"),
            channel=_fallback(row.get("channel"), "Unspecified"),
            quantity=_safe_float(row.get("quantity")), unit_price=_safe_float(row.get("unit_price")),
            revenue=float(row["revenue"]), cost=_safe_float(row.get("cost")), profit=_safe_float(row.get("profit")),
            discount=_safe_float(row.get("discount")), raw_values={},
        ))
    db.add_all(records)
    db.commit()
    db.refresh(dataset)
    return dataset


def _str_or_none(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text if text and text.lower() not in {"nan", "none", "<na>"} else None


def _fallback(value: Any, fallback: str) -> str:
    return _str_or_none(value) or fallback


def dataset_to_dict(dataset: Dataset) -> dict[str, Any]:
    return {
        "id": dataset.id, "name": dataset.name, "source": dataset.source,
        "created_at": dataset.created_at.isoformat() + "Z", "row_count": dataset.row_count,
        "currency": dataset.currency, "is_demo": dataset.is_demo,
        "date_min": dataset.date_min, "date_max": dataset.date_max,
        "dropped_rows": (dataset.fields_json or {}).get("dropped_rows", 0),
    }


def parse_mapping(raw: str) -> dict[str, str]:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="Column mapping was not valid JSON.") from exc
    if not isinstance(obj, dict):
        raise HTTPException(status_code=422, detail="Column mapping must be an object.")
    mapping = {str(k): str(v) for k, v in obj.items() if k in FIELDS and v and str(v).lower() != "none"}
    return mapping
