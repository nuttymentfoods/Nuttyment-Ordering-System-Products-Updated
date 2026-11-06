const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"
  }
});

const enc = new TextEncoder();

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

async function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) return false;
  try {
    if ((await sign(payloadPart, secret)) !== signature) return false;
    const raw = atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/"));
    const decoded = decodeURIComponent(Array.from(raw, c =>
      "%" + c.charCodeAt(0).toString(16).padStart(2, "0")
    ).join(""));
    const payload = JSON.parse(decoded);
    return payload.role === "admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function safe(value, max = 500) {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, max);
}

function auth(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return verifyToken(token, env.ADMIN_TOKEN_SECRET || "");
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must contain valid JSON.");
  }
}

async function notify(order, items, env) {
  const lines = items.map(item =>
    `${item.quantity} x ${item.product_name} (${item.pack_type})`
  ).join("\n");
  const message = [
    `New Nuttyment order ${order.order_number}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Email: ${order.email}`,
    "Items:", lines,
    `Total: ${order.currency} ${(order.total_paise / 100).toFixed(2)}`,
    `Payment: ${order.payment_method}`,
    `Ship to: ${order.address}, ${order.city}, ${order.state} ${order.postal_code}, ${order.country}`
  ].join("\n");

  let emailSent = false;
  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || "Nuttyment Orders <orders@resend.dev>",
          to: [env.STORE_EMAIL || "nuttymentfoods@gmail.com"],
          subject: `New order ${order.order_number}`,
          text: message
        })
      });
      emailSent = response.ok;
    } catch (error) {
      console.error("Nuttyment email notification failed:", error);
    }
  }
  return { emailSent };
}

async function createCodOrder(request, env) {
  const body = await readJson(request);
  const name = safe(body.name, 100);
  const email = safe(body.email, 160);
  const phone = safe(body.phone, 30);
  const address = safe(body.address, 300);
  const city = safe(body.city, 100);
  const state = safe(body.state, 100);
  const postal = safe(body.postal_code, 20);
  const country = safe(body.country, 80);
  const notes = safe(body.notes, 500);

  // Enforce COD on the server; frontend restrictions alone are not security.
  if (body.payment_method && body.payment_method !== "cod") {
    return json({ error: "Only Cash on Delivery (COD) is currently available." }, 400);
  }

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !phone || !address ||
      !city || !state || !postal || !country || !Array.isArray(body.items) ||
      body.items.length === 0) {
    return json({ error: "Please complete all required fields and add at least one product." }, 400);
  }

  if (body.items.length > 20) {
    return json({ error: "An order can contain no more than 20 different products." }, 400);
  }

  // Merge duplicate product IDs and strictly validate quantities.
  const quantityById = new Map();
  for (const raw of body.items) {
    const productId = safe(raw?.id, 80);
    const quantity = Number(raw?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return json({ error: "Each product must have a valid ID and a quantity from 1 to 50." }, 400);
    }
    const combined = (quantityById.get(productId) || 0) + quantity;
    if (combined > 50) {
      return json({ error: "Maximum quantity for one product is 50." }, 400);
    }
    quantityById.set(productId, combined);
  }

  const requested = [...quantityById.entries()].map(([id, quantity]) => ({ id, quantity }));
  const products = [];
  let previewTotal = 0;

  // Friendly validation before the transaction. The SQL transaction below repeats
  // the stock/active/price conditions to protect against simultaneous checkouts.
  for (const item of requested) {
    const product = await env.DB.prepare(
      "SELECT id,name,pack_type,price_paise,active,stock FROM products WHERE id=?"
    ).bind(item.id).first();

    if (!product || product.active !== 1) {
      return json({ error: "One selected product is unavailable. Please refresh your cart." }, 409);
    }
    if (product.price_paise === null || product.price_paise === undefined ||
        !Number.isInteger(Number(product.price_paise)) || Number(product.price_paise) < 0) {
      return json({ error: `Price is not configured correctly for ${product.name}. Please contact the store.` }, 409);
    }
    if (product.stock !== null && Number(product.stock) < item.quantity) {
      return json({ error: `Insufficient stock for ${product.name}. Available quantity: ${product.stock}.` }, 409);
    }

    previewTotal += Number(product.price_paise) * item.quantity;
    products.push({ ...product, quantity: item.quantity });
  }

  const orderId = crypto.randomUUID();
  const orderNumber = "NUT-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" +
    crypto.randomUUID().slice(0, 6).toUpperCase();

  // One conditional INSERT validates every requested product in the transaction.
  // If any item became unavailable/understocked, no order row is inserted.
  const requestedValues = requested.map(() => "(?, ?)").join(", ");
  const requestedBindings = requested.flatMap(item => [item.id, item.quantity]);
  const orderInsertSql = `
    WITH requested(id, quantity) AS (VALUES ${requestedValues}),
    valid_products AS (
      SELECT p.id, p.price_paise, r.quantity
      FROM requested r
      JOIN products p ON p.id = r.id
      WHERE p.active = 1
        AND p.price_paise IS NOT NULL
        AND (p.stock IS NULL OR p.stock >= r.quantity)
    ),
    totals AS (
      SELECT COALESCE(SUM(price_paise * quantity), 0) AS subtotal,
             COUNT(*) AS item_count
      FROM valid_products
    )
    INSERT INTO orders (
      id, order_number, customer_name, email, phone, address, city, state,
      postal_code, country, notes, payment_method, payment_status, order_status,
      subtotal_paise, shipping_paise, total_paise, currency
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cod', 'pending', 'new',
           subtotal, 0, subtotal, 'INR'
    FROM totals
    WHERE item_count = ?
  `;

  const statements = [
    env.DB.prepare(orderInsertSql).bind(
      ...requestedBindings,
      orderId, orderNumber, name, email, phone, address, city, state,
      postal, country, notes, requested.length
    )
  ];

  // Deduct finite stock inside the same D1 batch. NULL stock means unlimited.
  for (const item of requested) {
    statements.push(env.DB.prepare(`
      UPDATE products
      SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND stock IS NOT NULL AND stock >= ?
        AND EXISTS (SELECT 1 FROM orders WHERE id = ?)
    `).bind(item.quantity, item.id, item.quantity, orderId));
  }

  // Store a snapshot of product details and whether stock was managed/deducted.
  // Legacy order items receive defaults of 0 in migration 0002 and remain untouched.
  for (const item of requested) {
    statements.push(env.DB.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, pack_type, quantity,
        unit_price_paise, line_total_paise, stock_managed, stock_deducted
      )
      SELECT ?, p.id, p.name, p.pack_type, ?, p.price_paise,
             p.price_paise * ?,
             CASE WHEN p.stock IS NULL THEN 0 ELSE 1 END,
             CASE WHEN p.stock IS NULL THEN 0 ELSE 1 END
      FROM products p
      WHERE p.id = ? AND p.active = 1
        AND EXISTS (SELECT 1 FROM orders WHERE id = ?)
    `).bind(orderId, item.quantity, item.quantity, item.id, orderId));
  }

  const results = await env.DB.batch(statements);
  const inserted = Number(results?.[0]?.meta?.changes || 0);
  if (inserted !== 1) {
    return json({
      error: "One or more products became unavailable or no longer have enough stock. Your order was not placed. Please refresh the shop and try again."
    }, 409);
  }

  const order = {
    id: orderId,
    order_number: orderNumber,
    customer_name: name,
    email,
    phone,
    address,
    city,
    state,
    postal_code: postal,
    country,
    notes,
    payment_method: "cod",
    payment_status: "pending",
    order_status: "new",
    subtotal_paise: previewTotal,
    total_paise: previewTotal,
    currency: "INR"
  };

  const notification = await notify(order, products, env);
  return json({
    order: { id: orderId, order_number: orderNumber, total_paise: previewTotal, currency: "INR", payment_method: "cod" },
    payment: null,
    notifications: notification
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  try {
    if (!env.DB) return json({ error: "D1 database binding DB is missing." }, 500);

    if (path === "products" && request.method === "GET") {
      const { results = [] } = await env.DB.prepare(`
        SELECT id,name,description,image,pack_type,price_paise,currency,stock
        FROM products WHERE active=1 ORDER BY name
      `).all();
      return json({ products: results });
    }

    if (path === "orders" && request.method === "POST") {
      return await createCodOrder(request, env);
    }

    // Online payments are deliberately disabled for this COD-only release.
    if (path === "payments/verify") {
      return json({ error: "Online payments are disabled. Only COD is available." }, 410);
    }

    if (path === "admin/login" && request.method === "POST") {
      const body = await readJson(request);
      if (!env.ADMIN_PASSWORD || !env.ADMIN_TOKEN_SECRET) {
        return json({ error: "Admin credentials are not configured in Cloudflare Production settings." }, 503);
      }
      if (!body.password || body.password !== env.ADMIN_PASSWORD) {
        return json({ error: "Incorrect admin password." }, 401);
      }
      const payload = b64(enc.encode(JSON.stringify({
        exp: Date.now() + 8 * 60 * 60 * 1000,
        role: "admin"
      })));
      return json({ token: payload + "." + await sign(payload, env.ADMIN_TOKEN_SECRET) });
    }

    if (path.startsWith("admin/")) {
      if (!await auth(request, env)) return json({ error: "Please sign in again." }, 401);

      if (path === "admin/orders" && request.method === "GET") {
        const { results = [] } = await env.DB.prepare(
          "SELECT * FROM orders ORDER BY created_at DESC LIMIT 300"
        ).all();
        for (const order of results) {
          const { results: items = [] } = await env.DB.prepare(
            "SELECT * FROM order_items WHERE order_id=?"
          ).bind(order.id).all();
          order.items = items;
        }
        return json({ orders: results });
      }

      if (path === "admin/reports" && request.method === "GET") {
        const { results = [] } = await env.DB.prepare(`
          SELECT total_paise,payment_method,payment_status,order_status
          FROM orders ORDER BY created_at DESC LIMIT 300
        `).all();
        const summary = {
          order_count: results.length,
          total_value_paise: 0,
          paid_revenue_paise: 0,
          cod_orders: 0,
          paid_orders: 0,
          pending_payment: 0,
          delivered_orders: 0,
          cancelled_orders: 0
        };
        for (const order of results) {
          summary.total_value_paise += Number(order.total_paise) || 0;
          if (order.payment_status === "paid") {
            summary.paid_orders++;
            summary.paid_revenue_paise += Number(order.total_paise) || 0;
          } else summary.pending_payment++;
          if (order.payment_method === "cod") summary.cod_orders++;
          if (order.order_status === "delivered") summary.delivered_orders++;
          if (order.order_status === "cancelled") summary.cancelled_orders++;
        }
        return json({ summary, scope: "latest_300" });
      }

      if (path === "admin/orders" && request.method === "DELETE") {
        const body = await readJson(request);
        const id = safe(body.id, 80);
        if (!id) return json({ error: "Order ID is required." }, 400);
        const existing = await env.DB.prepare("SELECT id FROM orders WHERE id=?").bind(id).first();
        if (!existing) return json({ error: "Order not found." }, 404);

        // Restore only inventory that this version actually deducted. Existing
        // historical order items default to stock_deducted=0 and are not changed.
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE products
            SET stock = stock + (
              SELECT COALESCE(SUM(oi.quantity),0)
              FROM order_items oi
              WHERE oi.order_id=? AND oi.product_id=products.id AND oi.stock_deducted=1
            ), updated_at=CURRENT_TIMESTAMP
            WHERE stock IS NOT NULL AND EXISTS (
              SELECT 1 FROM order_items oi
              WHERE oi.order_id=? AND oi.product_id=products.id AND oi.stock_deducted=1
            )
          `).bind(id, id),
          env.DB.prepare("DELETE FROM order_items WHERE order_id=?").bind(id),
          env.DB.prepare("DELETE FROM orders WHERE id=?").bind(id)
        ]);
        return json({ ok: true, stock_restored: true });
      }

      if (path === "admin/orders/status" && request.method === "PATCH") {
        const body = await readJson(request);
        const id = safe(body.id, 80);
        const status = safe(body.status, 30);
        const allowed = ["new", "confirmed", "processing", "shipped", "delivered", "cancelled"];
        if (!id || !allowed.includes(status)) return json({ error: "A valid order ID and status are required." }, 400);

        const existing = await env.DB.prepare(
          "SELECT id,order_status FROM orders WHERE id=?"
        ).bind(id).first();
        if (!existing) return json({ error: "Order not found." }, 404);
        if (existing.order_status === status) return json({ ok: true, unchanged: true });

        if (status === "cancelled") {
          // Cancellation restores only stock that was deducted by this release.
          const results = await env.DB.batch([
            env.DB.prepare(`
              UPDATE orders SET order_status='cancelled',updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND order_status=?
            `).bind(id, existing.order_status),
            env.DB.prepare(`
              UPDATE products
              SET stock = stock + (
                SELECT COALESCE(SUM(oi.quantity),0)
                FROM order_items oi
                WHERE oi.order_id=? AND oi.product_id=products.id AND oi.stock_deducted=1
              ), updated_at=CURRENT_TIMESTAMP
              WHERE stock IS NOT NULL AND EXISTS (
                SELECT 1 FROM order_items oi
                WHERE oi.order_id=? AND oi.product_id=products.id AND oi.stock_deducted=1
              ) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND order_status='cancelled')
            `).bind(id, id, id),
            env.DB.prepare(`
              UPDATE order_items SET stock_deducted=0
              WHERE order_id=? AND stock_deducted=1
                AND EXISTS (SELECT 1 FROM orders WHERE id=? AND order_status='cancelled')
            `).bind(id, id)
          ]);
          if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
            return json({ error: "Order status was not changed. Refresh and try again." }, 409);
          }
          return json({ ok: true, stock_restored: true });
        }

        if (existing.order_status === "cancelled") {
          // Reopening a cancelled order must reserve its previously managed stock
          // again. The status update is conditional, so insufficient stock means
          // no status change and no partial deduction.
          const results = await env.DB.batch([
            env.DB.prepare(`
              UPDATE orders SET order_status=?,updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND order_status='cancelled'
                AND NOT EXISTS (
                  SELECT 1 FROM order_items oi
                  JOIN products p ON p.id=oi.product_id
                  WHERE oi.order_id=orders.id
                    AND oi.stock_managed=1 AND oi.stock_deducted=0
                    AND p.stock IS NOT NULL AND p.stock < oi.quantity
                )
            `).bind(status, id),
            env.DB.prepare(`
              UPDATE products
              SET stock=stock-(
                SELECT oi.quantity FROM order_items oi
                WHERE oi.order_id=? AND oi.product_id=products.id
                  AND oi.stock_managed=1 AND oi.stock_deducted=0 LIMIT 1
              ), updated_at=CURRENT_TIMESTAMP
              WHERE stock IS NOT NULL AND EXISTS (
                SELECT 1 FROM order_items oi
                WHERE oi.order_id=? AND oi.product_id=products.id
                  AND oi.stock_managed=1 AND oi.stock_deducted=0
              ) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND order_status=?)
            `).bind(id, id, id, status),
            env.DB.prepare(`
              UPDATE order_items SET stock_deducted=1
              WHERE order_id=? AND stock_managed=1 AND stock_deducted=0
                AND EXISTS (SELECT 1 FROM products p WHERE p.id=order_items.product_id AND p.stock IS NOT NULL)
                AND EXISTS (SELECT 1 FROM orders WHERE id=? AND order_status=?)
            `).bind(id, id, status)
          ]);
          if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
            return json({ error: "Not enough stock to reopen this cancelled order. The status was not changed." }, 409);
          }
          return json({ ok: true, stock_deducted: true });
        }

        const result = await env.DB.prepare(`
          UPDATE orders SET order_status=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND order_status=?
        `).bind(status, id, existing.order_status).run();
        if (!Number(result?.meta?.changes || 0)) return json({ error: "Order status was not changed. Refresh and try again." }, 409);
        return json({ ok: true });
      }

      if (path === "admin/products" && request.method === "GET") {
        const { results = [] } = await env.DB.prepare("SELECT * FROM products ORDER BY name").all();
        return json({ products: results });
      }

      if (path === "admin/products" && request.method === "POST") {
        const body = await readJson(request);
        const name = safe(body.name, 120);
        const description = safe(body.description, 500);
        const image = safe(body.image, 500);
        const pack = safe(body.pack_type, 60);
        const price = Math.round(Number(body.price) * 100);
        const stock = body.stock === "" || body.stock === undefined || body.stock === null
          ? null : Number(body.stock);
        if (!name || !pack || !Number.isFinite(price) || price <= 0) {
          return json({ error: "Enter a product name, pack size and a valid price greater than zero." }, 400);
        }
        if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
          return json({ error: "Stock must be a non-negative whole number or left blank." }, 400);
        }
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product";
        const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(`
          INSERT INTO products(id,name,description,image,pack_type,price_paise,currency,active,stock)
          VALUES(?,?,?,?,?,?,?,1,?)
        `).bind(id, name, description, image, pack, price, "INR", stock).run();
        return json({ ok: true, id });
      }

      if (path === "admin/products" && request.method === "DELETE") {
        const body = await readJson(request);
        const id = safe(body.id, 80);
        if (!id) return json({ error: "Product ID is required." }, 400);
        const result = await env.DB.prepare(
          "UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(id).run();
        if (!Number(result?.meta?.changes || 0)) return json({ error: "Product not found." }, 404);
        return json({ ok: true });
      }

      if (path === "admin/products" && request.method === "PATCH") {
        const body = await readJson(request);
        const id = safe(body.id, 80);
        const name = safe(body.name, 120);
        const description = safe(body.description, 500);
        const image = safe(body.image, 500);
        const pack = safe(body.pack_type, 60);
        const price = body.price === null || body.price === "" ? null : Math.round(Number(body.price) * 100);
        const stock = body.stock === "" || body.stock === null || body.stock === undefined
          ? null : Number(body.stock);
        if (!id || !name || !pack) return json({ error: "Product ID, name and pack size are required." }, 400);
        if (price !== null && (!Number.isFinite(price) || price < 0)) return json({ error: "Invalid price." }, 400);
        if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
          return json({ error: "Stock must be a non-negative whole number or left blank." }, 400);
        }
        const result = await env.DB.prepare(`
          UPDATE products SET name=?,description=?,image=?,pack_type=?,price_paise=?,stock=?,active=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).bind(name, description, image, pack, price, stock, body.active ? 1 : 0, id).run();
        if (!Number(result?.meta?.changes || 0)) return json({ error: "Product not found." }, 404);
        return json({ ok: true });
      }
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    console.error("Nuttyment API error:", error);
    if (error?.message === "Request body must contain valid JSON.") return json({ error: error.message }, 400);
    return json({ error: "Server error. Please try again later." }, 500);
  }
}
