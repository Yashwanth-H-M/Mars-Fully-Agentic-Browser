// Errors of provider calls, ported from the current Nanobrowser's src/background/llm/errors.ts, with what retries and
// overflow detection need.
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

/** The last underlying error of a `RetryError`, or the error itself. */
export function unwrapError(error: unknown): unknown {
  if (RetryError.isInstance(error) && error.lastError !== undefined) return error.lastError;
  return error;
}

export function getApiCallStatusCode(error: unknown): number | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.statusCode : undefined;
}

export function getApiCallResponseBody(error: unknown): string | undefined {
  const unwrapped = unwrapError(error);
  return APICallError.isInstance(unwrapped) ? unwrapped.responseBody : undefined;
}

export function isMissingApiKeyError(error: unknown): boolean {
  return LoadAPIKeyError.isInstance(unwrapError(error));
}

/** The error's message with its response body, for overflow matching and for the user. */
export function errorText(error: unknown): string {
  const unwrapped = unwrapError(error);
  const message = unwrapped instanceof Error ? unwrapped.message : String(unwrapped);
  const body = getApiCallResponseBody(unwrapped);
  return body && !message.includes(body) ? `${message} ${body}` : message;
}

/** Rate limits, server errors and network failures are retried; other client errors are not. */
export function isRetryable(error: unknown): boolean {
  const unwrapped = unwrapError(error);
  if (unwrapped instanceof Error && unwrapped.name === 'AbortError') return false;
  if (APICallError.isInstance(unwrapped)) {
    const status = unwrapped.statusCode;
    if (status === undefined) return unwrapped.isRetryable;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  const anyErr = unwrapped as any;
  const status = typeof anyErr?.status === 'number' ? anyErr.status : typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : undefined;
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  const text = String(anyErr?.message ?? '').toLowerCase();
  if (text.includes('rate limit') || text.includes('resource_exhausted') || text.includes('too many requests')) {
    return true;
  }
  // fetch rejects with a TypeError on network failures.
  return unwrapped instanceof TypeError;
}

/** The delay a `Retry-After` (seconds or a date) or `retry-after-ms` header asks for, in milliseconds. */
export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  const unwrapped = unwrapError(error);
  const anyErr = unwrapped as any;
  const headers = (APICallError.isInstance(unwrapped) ? unwrapped.responseHeaders : anyErr?.responseHeaders ?? anyErr?.headers) ?? {};
  const get = (name: string) => {
    if (typeof headers.get === 'function') return headers.get(name);
    return Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
  };
  const ms = Number(get('retry-after-ms'));
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const value = get('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  // Fall back to message parsing e.g. "Please retry after 2.5s" or "retry in 3s"
  const msgMatch = /retry (?:after|in)\s+([\d\.]+)\s*s/i.exec(String(anyErr?.message ?? ''));
  if (msgMatch) {
    const s = Number(msgMatch[1]);
    if (Number.isFinite(s) && s > 0) return Math.max(0, Math.round(s * 1000));
  }
  return undefined;
}

/** A refused request from a local server's CORS or origin check: no status, or 403 with no body. */
export function isOriginRefused(error: unknown): boolean {
  const unwrapped = unwrapError(error);
  if (unwrapped instanceof TypeError) return true;
  return getApiCallStatusCode(unwrapped) === 403;
}
