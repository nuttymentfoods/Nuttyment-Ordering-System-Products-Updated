# Nuttyment backend update: COD + stock deduction

This update preserves existing products, orders and order items. It does not rerun the initial schema or seed products.

## What changed

- COD is enforced by the server. Razorpay order creation and payment verification are disabled.
- Order creation validates product activity, current prices and available stock.
- Finite stock is deducted as part of a D1 batch with order and order-item inserts. A failed/insufficient-stock checkout does not create an order.
- Products with `stock = NULL` remain unlimited until an administrator enters a finite stock quantity.
- Each new order item records whether stock was managed and deducted.
- Cancelling a new-release order restores only stock actually deducted by this release.
- Reopening a cancelled order attempts to deduct its stock again; if stock is insufficient, the status is not changed.
- Deleting a new-release order restores its deducted stock before deleting it.
- Existing order items receive `stock_managed=0` and `stock_deducted=0`, so historical orders are not falsely restocked or deducted.

## Important: apply the additive D1 migration first

Back up the `nuttyment-orders` D1 database before making schema changes.

In Cloudflare Dashboard → Workers & Pages → D1 → `nuttyment-orders` → Console, run this SQL exactly once:

```sql
ALTER TABLE order_items ADD COLUMN stock_managed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0;
```

The same SQL is stored in `migrations/0002_stock_tracking.sql`.

Do **not** rerun `migrations/0001_init.sql` or `seed-products.sql` on the existing database. Do not run migration 0002 twice. If you already applied migration 0002, skip this SQL step.

To verify the columns after applying the migration, run:

```sql
PRAGMA table_info(order_items);
```

You should see both `stock_managed` and `stock_deducted`.

## Deploy the code

1. Keep the existing GitHub repository and Cloudflare Pages project.
2. Replace `functions/api/[[path]].js` with the version in this package.
3. Add `migrations/0002_stock_tracking.sql` to the repository.
4. Commit to the connected branch and wait for Cloudflare Pages deployment to succeed.
5. Keep the existing `DB` binding, `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, and store settings unchanged.
6. Razorpay secrets are no longer needed for this COD-only release; do not put secrets in GitHub.

## Set finite product stock

The current seeded products have `stock = NULL`, which means unlimited stock. In Admin → Products, edit each product and enter its actual available quantity. Save the product. A finite stock value is required for automatic deduction; blank means unlimited.

## Test safely

Use a temporary/test product or a small known stock quantity, and place only one controlled test order.

- If stock is 5 and a customer orders 2, stock should become 3.
- If that order is changed to `cancelled`, stock should return to 5.
- If a cancelled order is reopened, stock should be deducted again, provided enough stock remains.
- An order requesting more than available stock should be rejected and should not appear in Orders.
- Existing historical orders are not retroactively deducted or restocked.

COD is the only accepted payment method. Shipping is still zero in the current order total and must be confirmed separately by the store until shipping calculations are added.
