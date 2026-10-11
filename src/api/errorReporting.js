import { api } from './httpApi'

// Errors that happen in the browser would otherwise be invisible to whoever supports the shop.
// They are sent to the local server, which writes them next to its own log.
let installed = false
let reporting = false

function report(level, message, stack) {
  // A failing report must never trigger another report.
  if (reporting) return
  reporting = true
  api
    .reportError({
      level,
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : undefined,
      url: window.location.href.slice(0, 500),
      userAgent: navigator.userAgent.slice(0, 300),
    })
    .catch(() => {})
    .finally(() => {
      reporting = false
    })
}

export function installErrorReporting() {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    report('error', event.message, event.error?.stack)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    // Server and network errors are already shown to the person; they are not browser bugs.
    if (reason?.name === 'ApiError') return
    report('error', reason?.message ?? String(reason), reason?.stack)
  })
}
