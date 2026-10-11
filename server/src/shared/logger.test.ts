import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeDir } from '../../test/helpers/index.js'
import { createLogger } from './logger.js'

describe('createLogger', () => {
  let logsDir: string

  beforeEach(() => {
    logsDir = path.join(makeTempDir(), 'logs')
  })

  afterEach(() => {
    removeDir(path.dirname(logsDir))
  })

  const readLogText = (): string => {
    const files = fs.readdirSync(logsDir).filter((name) => /^app\..*\.log$/.test(name))
    expect(files).toHaveLength(1)
    return fs.readFileSync(path.join(logsDir, files[0] as string), 'utf8')
  }

  it('writes one JSON object per line to a dated app.*.log file, creating the directory', async () => {
    const logger = await createLogger({ level: 'info', logsDir, toStdout: false })

    logger.child({ component: 'test' }).info({ answer: 42 }, 'hello')

    const line = JSON.parse(readLogText().trim()) as Record<string, unknown>
    expect(line).toMatchObject({ level: 'info', component: 'test', answer: 42, msg: 'hello' })
    expect(typeof line.time).toBe('string')
  })

  it('never writes passwords, tokens or cookies to disk', async () => {
    const logger = await createLogger({ level: 'info', logsDir, toStdout: false })

    logger.info(
      {
        password: 'hunter2-plain',
        body: { oldPassword: 'old-secret', newPassword: 'new-secret' },
        token: 'tok-123',
        req: { headers: { cookie: 'qlcn_sid=session-secret', authorization: 'Bearer abc' } },
      },
      'sensitive',
    )

    const text = readLogText()
    for (const secret of ['hunter2-plain', 'old-secret', 'new-secret', 'tok-123', 'session-secret', 'Bearer abc']) {
      expect(text, secret).not.toContain(secret)
    }
    expect(text).toContain('[redacted]')
  })

  it('respects the configured level', async () => {
    const logger = await createLogger({ level: 'warn', logsDir, toStdout: false })

    logger.info('too quiet')
    logger.warn('loud enough')

    const text = readLogText()
    expect(text).not.toContain('too quiet')
    expect(text).toContain('loud enough')
  })
})
