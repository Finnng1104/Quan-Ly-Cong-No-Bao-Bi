import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeDir } from '../../test/helpers/index.js'
import { ConfigError, DEFAULT_PORT, defaultDataDir, loadConfig } from './index.js'

describe('defaultDataDir', () => {
  it('keeps customer data outside the app folder on every OS', () => {
    expect(defaultDataDir('win32', { ProgramData: 'D:\\ProgramData' }, 'C:\\Users\\shop')).toBe(
      'D:\\ProgramData\\QuanLyCongNo',
    )
    expect(defaultDataDir('win32', {}, 'C:\\Users\\shop')).toBe('C:\\ProgramData\\QuanLyCongNo')
    expect(defaultDataDir('darwin', {}, '/Users/shop')).toBe(
      '/Users/shop/Library/Application Support/QuanLyCongNo',
    )
    expect(defaultDataDir('linux', {}, '/home/shop')).toBe('/home/shop/.local/share/QuanLyCongNo')
  })
})

describe('loadConfig', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = makeTempDir()
  })

  afterEach(() => {
    removeDir(dataDir)
  })

  const writeConfigFile = (content: string): void => {
    fs.writeFileSync(path.join(dataDir, 'config.json'), content)
  }

  it('uses defaults when nothing is configured', () => {
    const config = loadConfig({ flags: { dataDir }, env: {} })

    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logLevel).toBe('info')
    expect(config.host).toBe('127.0.0.1')
    expect(config.dbPath).toBe(path.join(dataDir, 'data', 'app.db'))
    expect(config.logsDir).toBe(path.join(dataDir, 'logs'))
    expect(config.backupsDir).toBe(path.join(dataDir, 'backups'))
  })

  it('applies precedence: flag > env > config.json > default', () => {
    writeConfigFile(JSON.stringify({ port: 9001, logLevel: 'warn' }))

    expect(loadConfig({ flags: { dataDir }, env: {} }).port).toBe(9001)
    expect(loadConfig({ flags: { dataDir }, env: { QLCN_PORT: '9002' } }).port).toBe(9002)
    expect(loadConfig({ flags: { dataDir, port: '9003' }, env: { QLCN_PORT: '9002' } }).port).toBe(9003)

    expect(loadConfig({ flags: { dataDir }, env: {} }).logLevel).toBe('warn')
    expect(loadConfig({ flags: { dataDir }, env: { QLCN_LOG_LEVEL: 'debug' } }).logLevel).toBe('debug')
  })

  it('reads the data directory from the environment', () => {
    const config = loadConfig({ flags: {}, env: { QLCN_DATA_DIR: dataDir } })

    expect(config.dataDir).toBe(dataDir)
  })

  it('keeps unknown keys in config.json valid (later phases add more)', () => {
    writeConfigFile(JSON.stringify({ port: 9001, backup: { destinations: [] } }))

    expect(() => loadConfig({ flags: { dataDir }, env: {} })).not.toThrow()
  })

  it('rejects an invalid port, log level or config file', () => {
    expect(() => loadConfig({ flags: { dataDir, port: '80' }, env: {} })).toThrowError(ConfigError)
    expect(() => loadConfig({ flags: { dataDir, port: 'abc' }, env: {} })).toThrowError(ConfigError)
    expect(() => loadConfig({ flags: { dataDir, logLevel: 'loud' }, env: {} })).toThrowError(ConfigError)

    writeConfigFile('{ not json')
    expect(() => loadConfig({ flags: { dataDir }, env: {} })).toThrowError(ConfigError)

    writeConfigFile(JSON.stringify({ port: 'eight' }))
    expect(() => loadConfig({ flags: { dataDir }, env: {} })).toThrowError(ConfigError)
  })
})
