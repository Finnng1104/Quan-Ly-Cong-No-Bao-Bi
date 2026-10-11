import { describe, expect, it } from 'vitest'
import { createCaptureLogger, waitFor, type LogRecord } from '../test/helpers/index.js'
import { startSupervisor } from './supervisor.js'

// Tiny child programs, run with `node -e`. Real processes, so spawn/exit/IPC are exercised for real.
const EXIT_WITH_1 = 'process.exit(1)'
const EXIT_WITH_4 = 'process.exit(4)'
const EXITS_ON_SHUTDOWN_MESSAGE =
  "process.on('message', (m) => { if (m && m.type === 'shutdown') process.exit(0) }); setInterval(() => {}, 1000)"
const IGNORES_SHUTDOWN_MESSAGE = "process.on('message', () => {}); setInterval(() => {}, 1000)"

const messages = (records: LogRecord[]): unknown[] => records.map((record) => record.msg)
const count = (records: LogRecord[], message: string): number =>
  messages(records).filter((msg) => msg === message).length

function supervise(script: string, overrides: Partial<Parameters<typeof startSupervisor>[0]> = {}) {
  const { logger, records } = createCaptureLogger()
  const handle = startSupervisor({
    command: process.execPath,
    args: ['-e', script],
    logger,
    backoffMs: [5],
    ...overrides,
  })
  return { handle, records }
}

describe('supervisor', () => {
  it('restarts a crashing process and gives up after too many restarts', async () => {
    const { handle, records } = supervise(EXIT_WITH_1, { maxRestartsInWindow: 3, windowMs: 60_000 })

    const result = await handle.done

    expect(result).toEqual({ reason: 'gave-up', lastExitCode: 1 })
    // first start + 3 restarts
    expect(count(records, 'server process started')).toBe(4)
    expect(count(records, 'restarting server process')).toBe(3)
    expect(messages(records)).toContain('too many restarts in a short time, supervisor gives up')
  })

  it('does not retry exit codes that restarting cannot fix', async () => {
    const { handle, records } = supervise(EXIT_WITH_4)

    const result = await handle.done

    expect(result).toEqual({ reason: 'fatal-exit', lastExitCode: 4 })
    expect(count(records, 'server process started')).toBe(1)
    expect(count(records, 'restarting server process')).toBe(0)
  })

  it('stops a healthy child gracefully through the IPC shutdown message', async () => {
    const { handle, records } = supervise(EXITS_ON_SHUTDOWN_MESSAGE)
    await waitFor(() => count(records, 'server process started') === 1, { description: 'child started' })

    const result = await handle.stop()

    expect(result).toEqual({ reason: 'stopped', lastExitCode: 0 })
    expect(count(records, 'restarting server process')).toBe(0)
  })

  it('can be stopped while waiting to restart', async () => {
    const { handle, records } = supervise(EXIT_WITH_1, { backoffMs: [60_000] })
    await waitFor(() => count(records, 'restarting server process') === 1, {
      description: 'entered backoff',
    })

    const startedAt = Date.now()
    const result = await handle.stop()

    expect(result.reason).toBe('stopped')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('kills a child that ignores the shutdown request', async () => {
    const { handle, records } = supervise(IGNORES_SHUTDOWN_MESSAGE, { shutdownTimeoutMs: 100 })
    await waitFor(() => count(records, 'server process started') === 1, { description: 'child started' })

    const result = await handle.stop()

    expect(result.reason).toBe('stopped')
    expect(messages(records)).toContain('server process did not exit in time, killing it')
  })

  it('treats a command that cannot be spawned as a failure and eventually gives up', async () => {
    const { logger, records } = createCaptureLogger()
    const handle = startSupervisor({
      command: 'definitely-not-an-existing-binary',
      args: [],
      logger,
      backoffMs: [5],
      maxRestartsInWindow: 2,
    })

    const result = await handle.done

    expect(result.reason).toBe('gave-up')
    expect(count(records, 'server process exited unexpectedly')).toBeGreaterThanOrEqual(2)
  })
})
