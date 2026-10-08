import "server-only";
import { dashboardConfig } from "./session";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function backend(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
) {
  let response: Response;
  try {
    response = await fetch(`${dashboardConfig().api}${path}`, {
      method,
      headers: {
        authorization: token.startsWith("StaffSession ")
          ? token
          : `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError(503, "API_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "API_REQUEST_FAILED";
    try {
      const data: unknown = await response.json();
      if (
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string" &&
        /^[A-Z0-9_]+$/.test(data.error)
      )
        code = data.error;
    } catch {
      /* Invalid upstream body is reported with a safe fixed code. */
    }
    throw new ApiError(response.status, code);
  }
  return response.json() as Promise<unknown>;
}
export function safeApiError(error: unknown) {
  return error instanceof ApiError
    ? { status: error.status, code: error.code }
    : { status: 503, code: "CONTROL_UNAVAILABLE" };
}
