PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', image TEXT DEFAULT '',
 pack_type TEXT DEFAULT 'Pouch', price_paise INTEGER, currency TEXT NOT NULL DEFAULT 'INR',
 active INTEGER NOT NULL DEFAULT 1, stock INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, email TEXT NOT NULL,
 phone TEXT NOT NULL, address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, postal_code TEXT NOT NULL,
 country TEXT NOT NULL, notes TEXT DEFAULT '', payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'pending',
 order_status TEXT NOT NULL DEFAULT 'new', subtotal_paise INTEGER NOT NULL, shipping_paise INTEGER NOT NULL DEFAULT 0,
 total_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', razorpay_order_id TEXT, razorpay_payment_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id TEXT NOT NULL, product_name TEXT NOT NULL, pack_type TEXT NOT NULL, quantity INTEGER NOT NULL,
 unit_price_paise INTEGER NOT NULL, line_total_paise INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
