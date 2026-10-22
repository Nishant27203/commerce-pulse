from __future__ import annotations

import io
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .data_service import (
    DEMO_PATH,
    FIELDS,
    dataset_to_dict,
    guess_mapping,
    normalize_sales,
    parse_mapping,
    persist_dataset,
    read_dataframe,
)
from .db import Base, SessionLocal, engine, get_db
from .models import Dataset, SaleRecord

ROOT_DIR = Path(__file__).resolve().parents[2]
@asynccontextmanager
async def lifespan(application: FastAPI):
    Base.metadata.create_all(bind=engine)
    _seed_demo()
    yield


app = FastAPI(
    title="Commerce Ledger API",
    description="Sales analytics, data import, and business insight API for the Commerce Ledger portfolio project.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _seed_demo() -> None:
    with SessionLocal() as db:
        exists = db.scalar(select(Dataset.id).where(Dataset.is_demo.is_(True)).limit(1))
        if exists:
            return
        if not DEMO_PATH.exists():
            return
        frame = pd.read_csv(DEMO_PATH)
        mapping = guess_mapping(list(frame.columns))
        persist_dataset(db, frame, mapping, "Commerce Ledger sample", "demo", "INR", True)



def _get_dataset(db: Session, dataset_id: int) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found. Refresh the page and choose an available dataset.")
    return dataset


def _records_frame(db: Session, dataset_id: int) -> pd.DataFrame:
    _get_dataset(db, dataset_id)
    records = db.scalars(select(SaleRecord).where(SaleRecord.dataset_id == dataset_id).order_by(SaleRecord.order_date.asc(), SaleRecord.id.asc())).all()
    data = [{
        "id": r.id, "date": r.order_date.isoformat(), "order_id": r.order_id,
        "customer": r.customer, "product": r.product, "category": r.category,
        "region": r.region, "channel": r.channel, "quantity": r.quantity,
        "unit_price": r.unit_price, "revenue": r.revenue, "cost": r.cost,
        "profit": r.profit, "discount": r.discount,
    } for r in records]
    return pd.DataFrame(data)


def _filter_frame(
    frame: pd.DataFrame,
    date_from: str | None = None,
    date_to: str | None = None,
    category: str | None = None,
    region: str | None = None,
    channel: str | None = None,
    search: str | None = None,
) -> pd.DataFrame:
    result = frame.copy()
    if result.empty:
        return result
    if date_from:
        result = result[result["date"] >= date_from]
    if date_to:
        result = result[result["date"] <= date_to]
    for key, value in [("category", category), ("region", region), ("channel", channel)]:
        if value and value != "All":
            result = result[result[key].fillna("") == value]
    if search and search.strip():
        needle = search.strip().casefold()
        columns = [c for c in ["order_id", "customer", "product", "category", "region", "channel"] if c in result]
        mask = False
        for column in columns:
            mask = mask | result[column].fillna("").astype(str).str.casefold().str.contains(needle, regex=False)
        result = result[mask]
    return result


def _sum_or_none(frame: pd.DataFrame, col: str) -> float | None:
    if col not in frame or frame[col].isna().all():
        return None
    return round(float(frame[col].fillna(0).sum()), 2)


def _safe_count_unique(series: pd.Series) -> int:
    present = series.dropna().astype(str)
    meaningful = present[present.str.strip().ne("")]
    return int(meaningful.nunique()) if len(meaningful) else 0


def _group(frame: pd.DataFrame, field: str, label_field: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
    if frame.empty or field not in frame:
        return []
    grouped = frame.groupby(field, dropna=False).agg(revenue=("revenue", "sum"), orders=("order_id", "nunique")).reset_index()
    if "profit" in frame:
        profits = frame.groupby(field, dropna=False)["profit"].sum(min_count=1).reset_index(name="profit")
        grouped = grouped.merge(profits, on=field, how="left")
    else:
        grouped["profit"] = None
    grouped[field] = grouped[field].fillna("Unspecified")
    grouped = grouped.sort_values("revenue", ascending=False).head(limit)
    total = float(frame["revenue"].sum()) if len(frame) else 0
    out = []
    for _, row in grouped.iterrows():
        name = str(row[field])
        item: dict[str, Any] = {
            "name": name, "revenue": round(float(row["revenue"] or 0), 2),
            "orders": int(row["orders"] or 0),
            "share": round((float(row["revenue"] or 0) / total * 100), 1) if total else 0,
        }
        profit = row.get("profit")
        item["profit"] = round(float(profit), 2) if pd.notna(profit) else None
        out.append(item)
    return out


def _dashboard_payload(dataset: Dataset, frame: pd.DataFrame) -> dict[str, Any]:
    if frame.empty:
        summary = {"revenue": 0, "profit": None, "orders": 0, "aov": 0, "margin": None, "units": 0, "records": 0, "customers": 0, "discount": None, "revenue_change": None}
        return {"dataset": dataset_to_dict(dataset), "summary": summary, "trend": [], "categories": [], "regions": [], "channels": [], "top_products": [], "insights": ["No rows match these filters. Clear one or more filters to see the wider picture."], "options": {"categories": [], "regions": [], "channels": []}}

    revenue = float(frame["revenue"].sum())
    profit = _sum_or_none(frame, "profit")
    # If order IDs are missing, rows become individual order lines for the order count.
    orders = _safe_count_unique(frame["order_id"])
    if not orders:
        orders = len(frame)
    aov = revenue / orders if orders else 0
    margin = (profit / revenue * 100) if profit is not None and revenue else None
    units = float(frame["quantity"].fillna(0).sum()) if "quantity" in frame else 0
    discount = float(frame["discount"].dropna().mean()) if "discount" in frame and frame["discount"].notna().any() else None

    dates = frame.copy()
    dates["month"] = pd.to_datetime(dates["date"], errors="coerce").dt.to_period("M").astype(str)
    trend_frame = dates.groupby("month").agg(revenue=("revenue", "sum")).reset_index()
    trend_profit = dates.groupby("month")["profit"].sum(min_count=1).reset_index(name="profit") if "profit" in dates else None
    if trend_profit is not None:
        trend_frame = trend_frame.merge(trend_profit, on="month", how="left")
    else:
        trend_frame["profit"] = None
    trend = [{"period": str(r["month"]), "revenue": round(float(r["revenue"]), 2), "profit": round(float(r["profit"]), 2) if pd.notna(r["profit"]) else None} for _, r in trend_frame.iterrows()]
    revenue_change = None
    if len(trend_frame) >= 2:
        prev, current = float(trend_frame.iloc[-2]["revenue"]), float(trend_frame.iloc[-1]["revenue"])
        if prev:
            revenue_change = round((current - prev) / prev * 100, 1)

    categories = _group(frame, "category", limit=8)
    regions = _group(frame, "region", limit=6)
    channels = _group(frame, "channel", limit=6)
    top_products = _group(frame, "product", limit=6)
    insights: list[str] = []
    if revenue_change is not None and len(trend) >= 2:
        direction = "up" if revenue_change >= 0 else "down"
        magnitude = abs(revenue_change)
        insights.append(f"Revenue is {direction} {magnitude:.1f}% in {trend[-1]['period']} compared with {trend[-2]['period']}. Treat this as a period-over-period signal, not a forecast.")
    if categories:
        top = categories[0]
        insights.append(f"{top['name']} leads category revenue at {top['share']:.1f}% of the filtered total.")
    if regions:
        top_region = regions[0]
        insights.append(f"{top_region['name']} is the largest region by revenue, contributing {top_region['share']:.1f}% of the current view.")
    if margin is not None:
        insights.append(f"Overall profit margin is {margin:.1f}%. Compare categories and channels before drawing conclusions about discount or cost drivers.")
    else:
        insights.append("Profit and margin are unavailable because the uploaded data does not contain a usable profit or cost field.")
    if discount is not None:
        insights.append(f"Average discount value is {discount:.2f} as stored in the source file. Confirm whether your source represents discounts as fractions or percentage points.")
    options = {
        "categories": sorted(frame["category"].dropna().astype(str).unique().tolist()),
        "regions": sorted(frame["region"].dropna().astype(str).unique().tolist()),
        "channels": sorted(frame["channel"].dropna().astype(str).unique().tolist()),
    }
    summary = {
        "revenue": round(revenue, 2), "profit": profit, "orders": int(orders),
        "aov": round(aov, 2), "margin": round(margin, 2) if margin is not None else None,
        "units": round(units, 2), "records": int(len(frame)),
        "customers": _safe_count_unique(frame["customer"]),
        "discount": round(discount, 3) if discount is not None else None,
        "revenue_change": revenue_change,
    }
    return {
        "dataset": dataset_to_dict(dataset), "summary": summary, "trend": trend,
        "categories": categories, "regions": regions, "channels": channels,
        "top_products": top_products, "insights": insights, "options": options,
    }


def _apply_filters(frame: pd.DataFrame, args: dict[str, Any]) -> pd.DataFrame:
    return _filter_frame(frame, args.get("date_from"), args.get("date_to"), args.get("category"), args.get("region"), args.get("channel"), args.get("search"))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "commerce-ledger-api", "version": app.version}


@app.get("/api/datasets")
def list_datasets(db: Session = Depends(get_db)) -> dict[str, Any]:
    datasets = db.scalars(select(Dataset).order_by(desc(Dataset.created_at))).all()
    return {"datasets": [dataset_to_dict(d) for d in datasets]}


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"dataset": dataset_to_dict(_get_dataset(db, dataset_id))}


@app.post("/api/data/preview")
async def preview_upload(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(20 * 1024 * 1024 + 1)
    frame = read_dataframe(data, file.filename or "upload.csv")
    mapping = guess_mapping(list(frame.columns))
    preview = frame.head(8).where(pd.notna(frame.head(8)), None).to_dict(orient="records")
    # Convert values such as pandas timestamps and numpy scalar values to JSON-safe values.
    safe_preview = json.loads(pd.DataFrame(preview).to_json(orient="records", date_format="iso")) if preview else []
    return {
        "file_name": file.filename or "uploaded file", "file_size": len(data), "row_count": len(frame),
        "columns": list(frame.columns), "suggested_mapping": mapping,
        "fields": FIELDS, "preview": safe_preview,
    }


@app.post("/api/data/analyze")
async def analyze_upload(
    file: UploadFile = File(...),
    mapping_json: str = Form(...),
    dataset_name: str = Form("My sales file"),
    currency: str = Form("INR"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    data = await file.read(20 * 1024 * 1024 + 1)
    frame = read_dataframe(data, file.filename or "upload.csv")
    mapping = parse_mapping(mapping_json)
    # Validate mapping before saving so an incorrect submission doesn't leave a partial dataset.
    normalize_sales(frame, mapping)
    dataset = persist_dataset(db, frame, mapping, dataset_name.strip() or Path(file.filename or "Sales dataset").stem, "upload", currency.upper()[:8], False)
    dashboard = _dashboard_payload(dataset, _records_frame(db, dataset.id))
    skipped = int((dataset.fields_json or {}).get("dropped_rows", 0))
    message = f"Imported {dataset.row_count:,} usable rows."
    if skipped:
        message += f" {skipped:,} rows were skipped because their date or sales value was missing or invalid."
    return {"dataset": dataset_to_dict(dataset), "dashboard": dashboard, "message": message}


@app.get("/api/dashboard")
def get_dashboard(
    dataset_id: int = Query(...), date_from: str | None = None, date_to: str | None = None,
    category: str | None = None, region: str | None = None, channel: str | None = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    dataset = _get_dataset(db, dataset_id)
    frame = _records_frame(db, dataset_id)
    filtered = _filter_frame(frame, date_from, date_to, category, region, channel)
    payload = _dashboard_payload(dataset, filtered)
    # Keep filter options sourced from the whole dataset, not from a narrowed view.
    payload["options"] = {
        "categories": sorted(frame["category"].dropna().astype(str).unique().tolist()) if not frame.empty else [],
        "regions": sorted(frame["region"].dropna().astype(str).unique().tolist()) if not frame.empty else [],
        "channels": sorted(frame["channel"].dropna().astype(str).unique().tolist()) if not frame.empty else [],
    }
    payload["filter_summary"] = {"active_rows": len(filtered), "total_rows": len(frame)}
    return payload


@app.get("/api/records")
def get_records(
    dataset_id: int = Query(...), page: int = Query(1, ge=1), page_size: int = Query(15, ge=5, le=100),
    search: str | None = None, date_from: str | None = None, date_to: str | None = None,
    category: str | None = None, region: str | None = None, channel: str | None = None,
    sort_by: str = Query("date"), sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _get_dataset(db, dataset_id)
    frame = _filter_frame(_records_frame(db, dataset_id), date_from, date_to, category, region, channel, search)
    allowed_sort = {"date", "order_id", "customer", "product", "category", "region", "channel", "quantity", "revenue", "profit"}
    if sort_by not in allowed_sort:
        sort_by = "date"
    frame = frame.sort_values(sort_by, ascending=sort_order.lower() != "desc", na_position="last") if not frame.empty else frame
    total = len(frame)
    start = (page - 1) * page_size
    rows = frame.iloc[start:start + page_size].where(pd.notna(frame.iloc[start:start + page_size]), None).to_dict(orient="records")
    safe_rows = json.loads(pd.DataFrame(rows).to_json(orient="records", date_format="iso")) if rows else []
    return {"rows": safe_rows, "page": page, "page_size": page_size, "total": total, "pages": max(1, (total + page_size - 1) // page_size)}


@app.get("/api/export.csv")
def export_csv(
    dataset_id: int = Query(...), date_from: str | None = None, date_to: str | None = None,
    category: str | None = None, region: str | None = None, channel: str | None = None,
    search: str | None = None, db: Session = Depends(get_db),
) -> StreamingResponse:
    dataset = _get_dataset(db, dataset_id)
    frame = _filter_frame(_records_frame(db, dataset_id), date_from, date_to, category, region, channel, search)
    csv = frame.to_csv(index=False).encode("utf-8-sig")
    filename = f"commerce-ledger-{dataset.id}-filtered.csv"
    return StreamingResponse(io.BytesIO(csv), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/export/summary.csv")
def export_summary(
    dataset_id: int = Query(...), date_from: str | None = None, date_to: str | None = None,
    category: str | None = None, region: str | None = None, channel: str | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    dataset = _get_dataset(db, dataset_id)
    frame = _filter_frame(_records_frame(db, dataset_id), date_from, date_to, category, region, channel)
    payload = _dashboard_payload(dataset, frame)
    summary = pd.DataFrame([{"metric": k, "value": v} for k, v in payload["summary"].items()])
    csv = summary.to_csv(index=False).encode("utf-8-sig")
    return StreamingResponse(io.BytesIO(csv), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="commerce-ledger-{dataset.id}-summary.csv"'})


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    dataset = _get_dataset(db, dataset_id)
    if dataset.is_demo:
        raise HTTPException(status_code=400, detail="The built-in demo dataset is kept as a safe starting point.")
    db.delete(dataset)
    db.commit()
    return {"message": "Dataset and its imported records were deleted."}


@app.get("/api/template.csv")
def download_template() -> Response:
    headers = ["Order Date", "Order ID", "Customer", "Product", "Category", "Region", "Channel", "Quantity", "Unit Price", "Sales", "Cost", "Profit", "Discount"]
    return Response(content=",".join(headers) + "\n", media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="sales_upload_template.csv"'})
