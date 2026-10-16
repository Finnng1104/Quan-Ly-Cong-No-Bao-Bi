export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'UNAVAILABLE'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string> }
}

/** An error whose message is safe to show to the user and maps 1:1 to an HTTP response. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly fields?: Record<string, string>

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = STATUS_BY_CODE[code]
    if (fields) this.fields = fields
  }
}

export function toErrorBody(code: ErrorCode, message: string, fields?: Record<string, string>): ErrorBody {
  return { error: { code, message, ...(fields ? { fields } : {}) } }
}

/** Maps a framework-raised 4xx status (bad JSON, payload too large...) onto our error codes. */
export function codeForStatus(statusCode: number): ErrorCode {
  switch (statusCode) {
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    case 429:
      return 'RATE_LIMITED'
    case 503:
      return 'UNAVAILABLE'
    default:
      return 'VALIDATION_ERROR'
  }
}
