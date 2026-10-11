import { spawn, type ChildProcess } from 'node:child_process'
import type { Logger } from 'pino'
import { NON_RETRYABLE_EXIT_CODES } from './shared/exit-codes.js'

export interface SupervisorOptions {
  command: string
  args: string[]
  logger: Logger
  env?: NodeJS.ProcessEnv
  /** Delay before the Nth consecutive restart; the last value is reused afterwards. */
  backoffMs?: readonly number[]
  /** Give up after this many restarts inside `windowMs`. */
  maxRestartsInWindow?: number
  windowMs?: number
  /** A child that ran at least this long is considered healthy: the backoff starts over. */
  stableAfterMs?: number
  /** How long a child gets to exit gracefully after stop() before it is killed. */
  shutdownTimeoutMs?: number
  nonRetryableExitCodes?: readonly number[]
}

export type SupervisorStopReason = 'stopped' | 'gave-up' | 'fatal-exit'

export interface SupervisorResult {
  reason: SupervisorStopReason
  lastExitCode: number | null
}

export interface SupervisorHandle {
  /** Resolves when the supervisor loop has ended. */
  done: Promise<SupervisorResult>
  /** Asks the child to shut down gracefully, then ends the loop. */
  stop(): Promise<SupervisorResult>
}

interface ChildExit {
  code: number | null
  signal: NodeJS.Signals | null
  spawnError?: Error
}

const DEFAULTS = {
  backoffMs: [1_000, 2_000, 5_000, 10_000, 60_000],
  maxRestartsInWindow: 10,
  windowMs: 5 * 60_000,
  stableAfterMs: 60_000,
  shutdownTimeoutMs: 10_000,
}

/**
 * Keeps a child process alive. Task Scheduler / launchd only start *this* process; crash
 * recovery lives here so Windows and macOS behave identically and every restart is logged.
 */
export function startSupervisor(options: SupervisorOptions): SupervisorHandle {
  const log = options.logger
  const backoffMs = options.backoffMs ?? DEFAULTS.backoffMs
  const maxRestarts = options.maxRestartsInWindow ?? DEFAULTS.maxRestartsInWindow
  const windowMs = options.windowMs ?? DEFAULTS.windowMs
  const stableAfterMs = options.stableAfterMs ?? DEFAULTS.stableAfterMs
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULTS.shutdownTimeoutMs
  const nonRetryable = new Set(options.nonRetryableExitCodes ?? NON_RETRYABLE_EXIT_CODES)

  let stopping = false
  let child: ChildProcess | null = null
  let cancelBackoffWait: (() => void) | null = null

  function runChild(): Promise<ChildExit> {
    return new Promise((resolve) => {
      let settled = false
      const settle = (exit: ChildExit): void => {
        if (settled) return
        settled = true
        child = null
        resolve(exit)
      }

      const spawned = spawn(options.command, options.args, {
        // The 4th channel is IPC: the only portable way to ask a Windows process to exit gracefully.
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: options.env ?? process.env,
        windowsHide: true,
      })
      child = spawned
      log.info({ pid: spawned.pid }, 'server process started')

      spawned.once('error', (error) => settle({ code: null, signal: null, spawnError: error }))
      spawned.once('exit', (code, signal) => settle({ code, signal }))
    })
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done(): void {
        clearTimeout(timer)
        cancelBackoffWait = null
        resolve()
      }
      cancelBackoffWait = done
    })
  }

  const restartTimestamps: number[] = []
  let consecutiveFailures = 0

  const done = (async (): Promise<SupervisorResult> => {
    for (;;) {
      const startedAt = Date.now()
      const exit = await runChild()
      const ranMs = Date.now() - startedAt

      if (stopping) return { reason: 'stopped', lastExitCode: exit.code }

      log.warn(
        { exitCode: exit.code, signal: exit.signal, ranMs, err: exit.spawnError },
        'server process exited unexpectedly',
      )

      if (exit.code !== null && nonRetryable.has(exit.code)) {
        log.error({ exitCode: exit.code }, 'exit code is not retryable, supervisor stops')
        return { reason: 'fatal-exit', lastExitCode: exit.code }
      }

      if (ranMs >= stableAfterMs) consecutiveFailures = 0

      const now = Date.now()
      while (restartTimestamps.length > 0 && now - (restartTimestamps[0] as number) > windowMs) {
        restartTimestamps.shift()
      }
      if (restartTimestamps.length >= maxRestarts) {
        log.error(
          { restarts: restartTimestamps.length, windowMs },
          'too many restarts in a short time, supervisor gives up',
        )
        return { reason: 'gave-up', lastExitCode: exit.code }
      }
      restartTimestamps.push(now)

      const delayMs = backoffMs[Math.min(consecutiveFailures, backoffMs.length - 1)] ?? 0
      consecutiveFailures += 1
      log.info({ delayMs, attempt: consecutiveFailures }, 'restarting server process')

      await sleep(delayMs)
      if (stopping) return { reason: 'stopped', lastExitCode: exit.code }
    }
  })()

  async function stop(): Promise<SupervisorResult> {
    if (!stopping) {
      stopping = true
      cancelBackoffWait?.()

      const running = child
      if (running && running.exitCode === null && running.signalCode === null) {
        log.info({ pid: running.pid }, 'asking server process to shut down')
        let delivered = false
        try {
          delivered = running.send({ type: 'shutdown' })
        } catch {
          delivered = false
        }
        if (!delivered) running.kill('SIGTERM')

        const killTimer = setTimeout(() => {
          log.warn({ pid: running.pid }, 'server process did not exit in time, killing it')
          running.kill('SIGKILL')
        }, shutdownTimeoutMs)
        killTimer.unref()
        running.once('exit', () => clearTimeout(killTimer))
      }
    }
    return done
  }

  return { done, stop }
}
