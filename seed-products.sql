-- Nuttyment Foods: four confirmed 65 g jar products at ₹170 each.
-- Run this AFTER migrations/0001_init.sql in the Cloudflare D1 Console.
INSERT INTO products (id,name,description,image,pack_type,price_paise,currency,active)
VALUES
('cheese-jar','Cheesy Makhana','Crunchy roasted makhana with a rich cheesy flavour.','Cheese_jar.png','65 g jar',17000,'INR',1),
('peri-jar','Peri Peri Makhana','Crunchy roasted makhana with a bold, tangy Peri Peri flavour.','Peri_jar.png','65 g jar',17000,'INR',1),
('pudina-jar','Pudina Makhana','Crunchy roasted makhana with a refreshing pudina flavour.','Pudina_jar.png','65 g jar',17000,'INR',1),
('salt-jar','Salt & Pepper Makhana','Crunchy roasted makhana seasoned with salt and pepper.','Salt_jar.png','65 g jar',17000,'INR',1)
ON CONFLICT(id) DO UPDATE SET
 name=excluded.name,
 description=excluded.description,
 image=excluded.image,
 pack_type=excluded.pack_type,
 price_paise=excluded.price_paise,
 currency=excluded.currency,
 active=1,
 updated_at=CURRENT_TIMESTAMP;

-- Deactivate the older draft pouch/duplicate products so only the four confirmed jars are listed.
UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP
WHERE id NOT IN ('cheese-jar','peri-jar','pudina-jar','salt-jar');
