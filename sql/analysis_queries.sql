-- Commerce Ledger: analyst practice queries for SQLite.
-- The application stores imported data in normalized `sales_records` and `datasets` tables.

-- 1. Monthly sales and margin.
SELECT
  strftime('%Y-%m', sr.order_date) AS month,
  ROUND(SUM(sr.revenue), 2) AS revenue,
  ROUND(SUM(sr.profit), 2) AS profit,
  ROUND(100.0 * SUM(sr.profit) / NULLIF(SUM(sr.revenue), 0), 2) AS margin_pct
FROM sales_records sr
WHERE sr.dataset_id = :dataset_id
GROUP BY strftime('%Y-%m', sr.order_date)
ORDER BY month;

-- 2. Category performance: compare revenue and profit contribution.
SELECT
  sr.category,
  ROUND(SUM(sr.revenue), 2) AS revenue,
  ROUND(SUM(sr.profit), 2) AS profit,
  COUNT(DISTINCT sr.order_id) AS orders
FROM sales_records sr
WHERE sr.dataset_id = :dataset_id
GROUP BY sr.category
ORDER BY revenue DESC;

-- 3. Top products, limited to the top 10 by sales.
SELECT
  sr.product,
  SUM(sr.quantity) AS units_sold,
  ROUND(SUM(sr.revenue), 2) AS revenue,
  ROUND(SUM(sr.profit), 2) AS profit
FROM sales_records sr
WHERE sr.dataset_id = :dataset_id
GROUP BY sr.product
ORDER BY revenue DESC
LIMIT 10;

-- 4. Regional revenue share.
WITH regional AS (
  SELECT region, SUM(revenue) AS revenue
  FROM sales_records
  WHERE dataset_id = :dataset_id
  GROUP BY region
)
SELECT region, ROUND(revenue, 2) AS revenue,
       ROUND(100.0 * revenue / NULLIF(SUM(revenue) OVER (), 0), 1) AS revenue_share_pct
FROM regional ORDER BY revenue DESC;

-- 5. Daily sales; useful for spotting peaks before investigating why they occurred.
SELECT order_date, ROUND(SUM(revenue), 2) AS revenue, COUNT(*) AS order_lines
FROM sales_records
WHERE dataset_id = :dataset_id
GROUP BY order_date
ORDER BY order_date;
