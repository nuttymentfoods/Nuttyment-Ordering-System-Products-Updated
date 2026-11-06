
import { onRequest as handleApi } from "../../api/[[path]].js";

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Map /shop/api/... to the existing /api/... backend.
  url.pathname = url.pathname.replace(
    /^\/shop\/api(?=\/|$)/,
    "/api"
  );

  const request = new Request(url.toString(), context.request);

  return handleApi({
    ...context,
    request
  });
}
