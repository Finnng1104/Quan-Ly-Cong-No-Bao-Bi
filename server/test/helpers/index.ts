import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import pino, { type Logger } from 'pino'

export type LogRecord = Record<string, unknown>

/** A pino logger that keeps every record in memory so tests can assert on what was logged. */
export function createCaptureLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = []
  const logger = pino(
    { level: 'trace', formatters: { level: (label) => ({ level: label }) } },
    { write: (chunk: string) => records.push(JSON.parse(chunk) as LogRecord) },
  )
  return { logger, records }
}

export function makeTempDir(prefix = 'qlcn-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000
  const intervalMs = options.intervalMs ?? 20
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${options.description ?? 'condition'}`)
}
