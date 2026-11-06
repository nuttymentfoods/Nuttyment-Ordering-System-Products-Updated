# Nuttyment Foods – ordering system (Cloudflare Pages + D1)

This package preserves the existing storefront pages and provides a product shop, cart, COD checkout, Cloudflare Pages API, admin dashboard and D1 schema. Online payments are disabled in this release.

## Important before going live
- The ZIP is a deployable source package, not a live deployment. No Cloudflare account, database, email provider, or secrets were connected from this chat.
- The four confirmed jar products are configured as 65 g each at ₹170 each. Verify the images, prices and product descriptions before going live.
- Global delivery is captured at checkout, but international shipping, duties, taxes, carrier rates, export documents and restricted-destination checks must be confirmed manually. The checkout does not promise a shipping price or international delivery availability.
- Checkout is COD-only. The backend rejects Razorpay requests even if a client attempts to send them.
- Email alerts require a Resend API key and verified sender domain. Order placement does not open WhatsApp or redirect customers to WhatsApp. Optional email alerts require a Resend API key and verified sender domain.

## 1. Create Cloudflare D1 database
1. Open Cloudflare Dashboard → Workers & Pages → D1 SQL Database → Create database.
2. Name it `nuttyment-orders`.
3. The `wrangler.toml` in this package is prefilled with the Nuttyment D1 database ID. If deploying to a different database, replace it with that database ID.
4. In the D1 database, open Console and run the complete contents of `migrations/0001_init.sql`.
5. In the D1 Console, run the complete contents of `seed-products.sql`. This creates the four confirmed 65 g jar products at ₹170 each and deactivates the older draft products.

## 2. Configure Cloudflare Pages
1. Push this folder to your GitHub repository (preserve all existing files).
2. Cloudflare Dashboard → Workers & Pages → your Pages project → Settings → Functions → D1 database bindings.
3. Add binding: variable name `DB`, select `nuttyment-orders`.
4. Add these Pages environment variables/secrets for Production (and Preview if needed):
   - `ADMIN_PASSWORD` – strong unique admin password.
   - `ADMIN_TOKEN_SECRET` – long random secret (32+ random characters).
   - `STORE_EMAIL` – `nuttymentfoods@gmail.com`.
   - `STORE_PHONE` – `+919921214272`.
   - `RESEND_API_KEY` – optional, for email alerts.
   - `EMAIL_FROM` – verified sender, e.g. `Nuttyment Orders <orders@your-verified-domain.com>`.
   - No Razorpay secrets are required; online payments are disabled.
5. Set Pages build command to blank / no build and output directory to `.`. Ensure Functions directory is deployed.
6. Deploy. Open `https://www.nuttyment.com/shop.html` and `https://www.nuttyment.com/admin.html`.

## 3. Configure products
1. Open `/admin.html` and sign in with `ADMIN_PASSWORD`.
2. Set each product's actual retail price and stock (blank stock means unlimited), then Save.
3. Do a COD test order and confirm it appears in the dashboard.

## 4. Admin dashboard features
- The Admin Dashboard at `/admin.html` lists only the latest 300 orders.
- Orders can be searched, filtered by status, updated, permanently deleted after confirmation, and exported to CSV.
- Reports (order count, order value, paid revenue, COD count, paid/pending/delivered/cancelled counts) are calculated only from those latest 300 orders.
- Products can be added from the dashboard with name, price, pack type, stock, description and an image URL/repository path. Add image files to the GitHub repository first, then enter their path (for example `assets/new-product.png`).
- Products can be edited and removed from the storefront. Remove deactivates a product instead of deleting its row, preserving historical order references.
- Order deletion is permanent and removes the order's line items too. Use the confirmation prompt carefully.

## 5. Stock deduction and cancellation

- Set a finite stock quantity for each product in the Admin Dashboard. A blank stock value means unlimited stock and is not deducted.
- New COD orders validate stock and deduct finite stock in one D1 batch. If any requested item is unavailable or has insufficient stock, the order is not created.
- Cancelling an order restores only the quantities that this release actually deducted. Reopening a cancelled order attempts to reserve those quantities again and refuses if stock is insufficient.
- Deleting a new order restores its deducted stock before removing it. Historical order items are marked as legacy by the migration defaults and are not adjusted.

## 6. Email notifications

- Email uses Resend API. Verify your sending domain and set `RESEND_API_KEY` + `EMAIL_FROM`.
- WhatsApp notifications and redirects are disabled.


## Notes / limitations to resolve before production
- Add real product pack weights, MRP/selling prices, GST treatment, shipping fee rules, return/refund policy, privacy policy, terms and international shipping policy.
- Shipping is currently stored as ₹0 until a shipping calculation is integrated. Confirm shipping, taxes and duties manually before confirming delivery.
- Admin authentication is a simple shared-password bearer token suitable as a starter. For a larger production operation, add Cloudflare Access or a managed identity provider, audit logging, rate limiting, bot protection and order export/backup.
- Do not put secrets in frontend JavaScript or commit them to GitHub.


## Local preview note
The shop page now falls back to `assets/products.json` when the `/api/products` endpoint is unavailable, so the four products can be previewed locally before D1 is connected. Product checkout and order storage still require the Cloudflare Pages Functions API and a configured D1 database. Serve the folder with a local web server (for example, `npm run dev` after configuring Wrangler) rather than opening the HTML file directly.
