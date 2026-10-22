import pandas as pd

from backend.app.data_service import guess_mapping, normalize_sales


def test_demo_columns_are_detected():
    frame = pd.read_csv("data/demo_sales.csv")
    mapping = guess_mapping(list(frame.columns))
    assert mapping["date"] == "Order Date"
    assert mapping["revenue"] == "Sales"
    assert mapping["quantity"] == "Quantity"
    assert mapping["unit_price"] == "Unit Price"
    assert mapping["profit"] == "Profit"
    normalized, _, dropped = normalize_sales(frame.head(20), mapping)
    assert len(normalized) == 20
    assert dropped == 0
    assert float(normalized["revenue"].sum()) > 0


def test_revenue_can_be_calculated_from_quantity_and_price():
    frame = pd.DataFrame({
        "purchase_day": ["2025-01-02", "2025-01-03", "bad-date"],
        "units": [2, 3, 1],
        "item price": [100, 50, 90],
        "territory": ["West", "East", "North"],
    })
    mapping = {"date": "purchase_day", "quantity": "units", "unit_price": "item price", "region": "territory"}
    normalized, _, dropped = normalize_sales(frame, mapping)
    assert list(normalized["revenue"]) == [200, 150]
    assert list(normalized["region"]) == ["West", "East"]
    assert dropped == 1
    assert normalized["profit"].isna().all()
