// Thin fetch wrapper for the local backend. Every request goes to the same origin under /api
// (in development Vite proxies it to the server), so no URL or CORS configuration is needed.

export class ApiError extends Error {
  constructor({ status, code, message, fields }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

// Set by the store so that an expired session sends the person back to the login page.
let onUnauthorized = () => {}
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

function toQueryString(query) {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export async function request(method, path, { query, body } = {}) {
  let response
  try {
    response = await fetch(`/api${path}${toQueryString(query)}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK',
      message: 'Không kết nối được máy chủ. Hãy kiểm tra ứng dụng đã chạy chưa.',
    })
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // Empty or non-JSON body: handled below through the status code.
  }

  if (!response.ok) {
    const error = payload?.error
    const apiError = new ApiError({
      status: response.status,
      code: error?.code ?? 'UNKNOWN',
      message: error?.message ?? `Lỗi máy chủ (${response.status})`,
      fields: error?.fields,
    })
    // A wrong password on the login form is not an expired session.
    if (response.status === 401 && path !== '/auth/login') onUnauthorized()
    throw apiError
  }
  return payload
}

/** A sentence that can be shown to the person, including the first field problem if any. */
export function messageOf(error) {
  if (!(error instanceof ApiError)) return 'Đã có lỗi xảy ra, vui lòng thử lại'
  const firstField = error.fields ? Object.values(error.fields)[0] : null
  return firstField && firstField !== error.message ? `${error.message}: ${firstField}` : error.message
}
