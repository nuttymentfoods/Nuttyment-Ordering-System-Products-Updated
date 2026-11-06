
export async function onRequest({ env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { error: "D1 database binding DB is missing" },
        { status: 500 }
      );
    }

    const { results = [] } = await env.DB.prepare(
      `SELECT id, name, description, image, pack_type,
              price_paise, currency, stock
       FROM products
       WHERE active = 1
       ORDER BY name`
    ).all();

    return Response.json({ products: results });
  } catch (error) {
    return Response.json(
      { error: error.message || "Database query failed" },
      { status: 500 }
    );
  }
}
