import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/db/client.js'
import { EXIT_CODE } from '../../src/shared/exit-codes.js'
import { getFreePort, makeTempDir, removeDir, waitFor } from '../helpers/index.js'

const MAIN = fileURLToPath(new URL('../../src/main.ts', import.meta.url))
const TEST_TIMEOUT_MS = 30_000

interface RunningProcess {
  child: ChildProcess
  exit: Promise<number | null>
  output: () => string
}

// `--import tsx` makes the child run the TypeScript sources exactly like `npm start` does.
function runMain(args: string[]): RunningProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let captured = ''
  child.stdout?.on('data', (chunk: Buffer) => (captured += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (captured += chunk.toString()))
  const exit = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  return { child, exit, output: () => captured }
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

describe('server process (real child processes)', () => {
  let dataDir: string
  let running: RunningProcess | null = null

  beforeEach(() => {
    dataDir = makeTempDir()
  })

  afterEach(() => {
    running?.child.kill('SIGKILL')
    running = null
    removeDir(dataDir)
  })

  // A database written by a "future" version of the app.
  const createFutureDatabase = (): void => {
    const db = openDatabase(path.join(dataDir, 'data', 'app.db'))
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES (99, 'from_the_future', 'x', '2099-01-01T00:00:00.000Z');
    `)
    db.close()
  }

  it(
    'starts, answers /api/health, and exits 0 on a graceful shutdown request',
    async () => {
      const port = await getFreePort()
      running = runMain(['serve', '--data-dir', dataDir, '--port', String(port)])

      await waitFor(() => isHealthy(port), { timeoutMs: 20_000, description: 'server healthy' })
      running.child.send({ type: 'shutdown' })

      expect(await running.exit).toBe(EXIT_CODE.OK)
      const logFiles = fs.readdirSync(path.join(dataDir, 'logs'))
      expect(logFiles.some((name) => /^app\..*\.log$/.test(name))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'refuses to start on a database newer than the code, with a dedicated exit code',
    async () => {
      createFutureDatabase()
      const port = await getFreePort()
      running = runMain(['serve', '--data-dir', dataDir, '--port', String(port)])

      expect(await running.exit).toBe(EXIT_CODE.DB_NEWER_THAN_CODE)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'exits with the config error code on an invalid port, before touching the database',
    async () => {
      running = runMain(['serve', '--data-dir', dataDir, '--port', '80'])

      expect(await running.exit).toBe(EXIT_CODE.CONFIG_INVALID)
      expect(running.output()).toContain('Invalid port')
      expect(fs.existsSync(path.join(dataDir, 'data', 'app.db'))).toBe(false)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'supervisor stops at once on a non-retryable failure instead of restart-looping',
    async () => {
      createFutureDatabase()
      const port = await getFreePort()
      running = runMain(['supervise', '--data-dir', dataDir, '--port', String(port)])

      expect(await running.exit).toBe(EXIT_CODE.DB_NEWER_THAN_CODE)
      const logText = fs
        .readdirSync(path.join(dataDir, 'logs'))
        .map((name) => fs.readFileSync(path.join(dataDir, 'logs', name), 'utf8'))
        .join('\n')
      expect(logText).toContain('exit code is not retryable')
      expect(logText).not.toContain('restarting server process')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'supervisor relays a stop request to the server and exits 0',
    async () => {
      const port = await getFreePort()
      running = runMain(['supervise', '--data-dir', dataDir, '--port', String(port)])

      await waitFor(() => isHealthy(port), { timeoutMs: 20_000, description: 'server healthy' })
      running.child.kill('SIGTERM')

      expect(await running.exit).toBe(EXIT_CODE.OK)
      await waitFor(async () => !(await isHealthy(port)), { description: 'server stopped' })
    },
    TEST_TIMEOUT_MS,
  )
})
