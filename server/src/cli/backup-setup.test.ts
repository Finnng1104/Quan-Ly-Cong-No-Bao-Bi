import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeDir } from '../../test/helpers/index.js'
import { buildS3Destination, saveDestination, BackupSetupError } from './backup-setup.js'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const valid = { accountOrEndpoint: ACCOUNT_ID, bucket: 'qlcn-khoilam', accessKeyId: 'AKIA', secretAccessKey: 'shh' }

describe('backup setup', () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })
  afterEach(() => removeDir(dir))

  describe('buildS3Destination', () => {
    it('builds the R2 endpoint from the account id', () => {
      expect(buildS3Destination(valid)).toEqual({
        type: 's3',
        endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
        bucket: 'qlcn-khoilam',
        region: 'auto',
        accessKeyId: 'AKIA',
        secretAccessKey: 'shh',
        prefix: '',
      })
    })

    it('accepts a full https endpoint and tidies the prefix', () => {
      const destination = buildS3Destination({
        ...valid,
        accountOrEndpoint: 'https://s3.example.com/ignored/path',
        prefix: '/qlcn',
      })
      expect(destination.endpoint).toBe('https://s3.example.com')
      expect(destination.prefix).toBe('qlcn/')
    })

    it.each([
      ['a short account id', { accountOrEndpoint: 'abc123' }],
      ['a plain http endpoint', { accountOrEndpoint: 'http://s3.example.com' }],
      ['an upper-case bucket', { bucket: 'QLCN' }],
      ['an empty key', { accessKeyId: ' ' }],
    ])('rejects %s', (_label, override) => {
      expect(() => buildS3Destination({ ...valid, ...override })).toThrow(BackupSetupError)
    })
  })

  describe('saveDestination', () => {
    const destination = buildS3Destination(valid)

    it('creates the file readable by its owner only', () => {
      const file = path.join(dir, 'config.json')
      saveDestination(file, destination)

      expect(JSON.parse(fs.readFileSync(file, 'utf8')).backup.destinations).toEqual([destination])
      expect(fs.statSync(file).mode & 0o077).toBe(0)
    })

    it('keeps other settings and replaces an older cloud destination', () => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(
        file,
        JSON.stringify({
          port: 9000,
          backup: {
            localRetention: 10,
            destinations: [{ type: 'folder', path: '/usb', mode: 'always' }, { type: 's3', bucket: 'old' }],
          },
        }),
      )

      saveDestination(file, destination)

      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(saved.port).toBe(9000)
      expect(saved.backup.localRetention).toBe(10)
      expect(saved.backup.destinations).toEqual([{ type: 'folder', path: '/usb', mode: 'always' }, destination])
    })

    it('refuses to overwrite a config file that is not valid JSON', () => {
      const file = path.join(dir, 'config.json')
      fs.writeFileSync(file, '{ broken')
      expect(() => saveDestination(file, destination)).toThrow(BackupSetupError)
      expect(fs.readFileSync(file, 'utf8')).toBe('{ broken')
    })
  })
})
