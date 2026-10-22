from fastapi.testclient import TestClient

from backend.app.main import app


def test_health_and_demo_dashboard():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        datasets = client.get("/api/datasets").json()["datasets"]
        demo = next(item for item in datasets if item["is_demo"])
        response = client.get("/api/dashboard", params={"dataset_id": demo["id"]})
        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"]["revenue"] > 0
        assert payload["trend"]
        assert payload["categories"]


def test_upload_preview_and_submit_flow():
    with TestClient(app) as client:
        csv = (
            b"Order Date,Sales,Quantity,Unit Price,Category,Region,Order ID\n"
            b"2025-01-01,200,2,100,Books,West,ORD-1\n"
            b"2025-01-02,150,3,50,Toys,East,ORD-2\n"
        )
        preview = client.post("/api/data/preview", files={"file": ("sales.csv", csv, "text/csv")})
        assert preview.status_code == 200
        payload = preview.json()
        assert payload["suggested_mapping"]["date"] == "Order Date"
        assert payload["suggested_mapping"]["revenue"] == "Sales"
        assert payload["row_count"] == 2

        submitted = client.post(
            "/api/data/analyze",
            files={"file": ("sales.csv", csv, "text/csv")},
            data={
                "mapping_json": '{"date":"Order Date","revenue":"Sales","quantity":"Quantity","unit_price":"Unit Price","category":"Category","region":"Region","order_id":"Order ID"}',
                "dataset_name": "Upload flow test",
                "currency": "INR",
            },
        )
        assert submitted.status_code == 200, submitted.text
        result = submitted.json()
        dataset_id = result["dataset"]["id"]
        assert result["dataset"]["row_count"] == 2
        dashboard = client.get("/api/dashboard", params={"dataset_id": dataset_id}).json()
        assert dashboard["summary"]["revenue"] == 350.0
        assert dashboard["summary"]["orders"] == 2
        records = client.get("/api/records", params={"dataset_id": dataset_id}).json()
        assert len(records["rows"]) == 2
        deleted = client.delete(f"/api/datasets/{dataset_id}")
        assert deleted.status_code == 200
