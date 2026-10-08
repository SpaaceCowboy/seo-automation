import { authenticatedSession } from "../../../lib/server";
import { boundedText, BodyLimitError } from "../../../lib/body";
import { cookies } from "next/headers";
import { identitySchema } from "@roco/shared/control";
import { z } from "zod";
import { backend, safeApiError } from "../../../lib/backend";
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  dashboardConfig,
  sameOrigin,
  permitLogin,
  issueSession,
  endSession,
} from "../../../lib/session";
export async function POST(request: Request) {
  const config = dashboardConfig();
  if (!sameOrigin(request, config.origin))
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (!permitLogin())
    return Response.json({ error: "LOGIN_RATE_LIMIT" }, { status: 429 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024)
    return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  try {
    const text = await boundedText(request, 1024);
    if (text.length > 1024)
      return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
    const { token } = z
      .strictObject({ token: z.string().min(32).max(256) })
      .parse(JSON.parse(text));
    const identity = identitySchema.parse(
      await backend("/control/session", token, "POST"),
    );
    const cookieStore = await cookies();
    endSession(cookieStore.get(SESSION_COOKIE)?.value);
    const { id } = issueSession(token, identity);
    cookieStore.set(SESSION_COOKIE, id, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return Response.json(
      { ok: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const safe =
      error instanceof BodyLimitError
        ? { status: 413, code: "REQUEST_TOO_LARGE" }
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? { status: 400, code: "INVALID_CREDENTIAL" }
          : safeApiError(error);
    return Response.json({ error: safe.code }, { status: safe.status });
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request, dashboardConfig().origin))
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const c = await cookies();
  const session = await authenticatedSession();
  if (session) await backend("/control/session", session.token, "DELETE");
  endSession(c.get(SESSION_COOKIE)?.value);
  c.delete(SESSION_COOKIE);
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
}
