from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="upload", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="INR", nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    date_min: Mapped[str | None] = mapped_column(String(10), nullable=True)
    date_max: Mapped[str | None] = mapped_column(String(10), nullable=True)
    fields_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    records: Mapped[list["SaleRecord"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )


class SaleRecord(Base):
    __tablename__ = "sales_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    source_row: Mapped[int] = mapped_column(Integer, default=0)
    order_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    customer: Mapped[str | None] = mapped_column(String(180), nullable=True)
    product: Mapped[str] = mapped_column(String(180), default="Unspecified product", nullable=False)
    category: Mapped[str] = mapped_column(String(120), default="Uncategorised", nullable=False)
    region: Mapped[str] = mapped_column(String(120), default="Unspecified", nullable=False)
    channel: Mapped[str] = mapped_column(String(120), default="Unspecified", nullable=False)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    revenue: Mapped[float] = mapped_column(Float, nullable=False)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    discount: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_values: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    dataset: Mapped[Dataset] = relationship(back_populates="records")
