import type { HttpResponseInit } from "@azure/functions";

export function json(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body };
}

/** Throw to short-circuit a handler with a specific HTTP status. */
export class HttpError extends Error {
  constructor(public status: number, public payload: unknown) {
    super(typeof payload === "string" ? payload : JSON.stringify(payload));
  }
}

export function conflict(reasons: string[]): never {
  throw new HttpError(409, { error: "Change blocked: it would break coverage.", reasons });
}
