// Distinct exit codes let the supervisor, installer and updater tell *why* the server stopped.
export const EXIT_CODE = {
  OK: 0,
  GENERIC_ERROR: 1,
  CONFIG_INVALID: 2,
  NATIVE_MODULE_LOAD_FAILED: 3,
  DB_NEWER_THAN_CODE: 4,
  DB_CORRUPT: 5,
  MIGRATION_FAILED: 6,
  SUPERVISOR_GAVE_UP: 7,
} as const

// Restarting cannot fix these: the same input would fail the same way, so the
// supervisor must stop instead of looping and flooding the logs.
export const NON_RETRYABLE_EXIT_CODES: readonly number[] = [
  EXIT_CODE.CONFIG_INVALID,
  EXIT_CODE.NATIVE_MODULE_LOAD_FAILED,
  EXIT_CODE.DB_NEWER_THAN_CODE,
  EXIT_CODE.DB_CORRUPT,
  EXIT_CODE.MIGRATION_FAILED,
]
