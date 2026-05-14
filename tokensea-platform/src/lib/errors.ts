export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function unauthorized(message = "Unauthorized"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Forbidden"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function badRequest(message: string, detail?: unknown): AppError {
  return new AppError(400, "BAD_REQUEST", message, detail);
}

export function rateLimited(message = "Rate limit exceeded", retryAfter = 3600): AppError & { retryAfter: number } {
  const err = new AppError(429, "RATE_LIMITED", message) as AppError & { retryAfter: number };
  err.retryAfter = retryAfter;
  return err;
}

export function internalError(message = "Internal server error"): AppError {
  return new AppError(500, "INTERNAL_ERROR", message);
}
