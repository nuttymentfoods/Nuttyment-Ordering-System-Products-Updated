-- Additive migration: preserves all existing orders and order items.
-- Existing rows receive 0, meaning this release did not deduct stock for them.
ALTER TABLE order_items ADD COLUMN stock_managed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0;
