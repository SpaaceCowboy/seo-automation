import { boundedText, BodyLimitError } from "../../../../lib/body";
import { backend, safeApiError } from "../../../../lib/backend";
import { authenticatedSession } from "../../../../lib/server";
import { dashboardConfig, sameOrigin } from "../../../../lib/session";
import { allowedControlPath } from "../../../../lib/paths";
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = "/" + (await context.params).path.join("/");
  if (!allowedControlPath(path, request.method))
    return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  try {
    const s = await authenticatedSession();
    if (!s)
      return Response.json({ error: "SIGN_IN_REQUIRED" }, { status: 401 });
    let body: unknown;
    if (request.method === "POST") {
      if (
        !sameOrigin(request, dashboardConfig().origin) ||
        request.headers.get("x-csrf-token") !== s.csrf
      )
        return Response.json({ error: "INVALID_CSRF" }, { status: 403 });
      const text = await boundedText(request, 32768);
      if (text.length > 32768)
        return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
      body = JSON.parse(text) as unknown;
    }
    const url = new URL(request.url);
    if (url.search.length > 2048)
      return Response.json({ error: "QUERY_TOO_LARGE" }, { status: 400 });
    const result = await backend(
      path + url.search,
      s.token,
      request.method,
      body,
    );
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const safe =
      error instanceof BodyLimitError
        ? { status: 413, code: "REQUEST_TOO_LARGE" }
        : error instanceof SyntaxError
          ? { status: 400, code: "INVALID_JSON" }
          : safeApiError(error);
    return Response.json(
      { error: safe.code },
      { status: safe.status, headers: { "cache-control": "no-store" } },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
