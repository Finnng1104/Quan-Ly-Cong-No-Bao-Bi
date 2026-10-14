#!/usr/bin/env node
// Builds one self-contained release archive for the platform this script runs on.
//
//   node packaging/build-release.mjs [--out <dir>] [--version <x.y.z>] [--skip-web]
//                                    [--simulate-broken]
//
// The archive holds everything the customer's machine needs, so nothing has to be installed
// first: the Node runtime that built it, the compiled server with its production dependencies
// (including the native SQLite addon, built by *this* Node), and the built web app.
//
//   qlcn-<version>-<os>-<arch>/
//     runtime/node            the exact Node binary the native addon was built against
//     server/dist, server/node_modules, server/package.json
//     web/                    built web app, served by the server
//     bin/qlcn[.cmd|.ps1]     support command (status, restore, doctor...)
//     version.json
//
// Release archives are built per OS/arch (native addon), normally by CI.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(serverDir, '..')

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: path.join(serverDir, 'release') },
    version: { type: 'string' },
    'skip-web': { type: 'boolean', default: false },
    // Test aid: produces a build that dies on start, to prove the updater rolls back.
    'simulate-broken': { type: 'boolean', default: false },
  },
})

const osNames = { darwin: 'darwin', win32: 'win', linux: 'linux' }
const platformKey = `${osNames[process.platform] ?? process.platform}-${process.arch}`
const serverPackage = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'))
const version = values.version ?? serverPackage.version
const archiveBase = `qlcn-${version}-${platformKey}`

const outDir = path.resolve(values.out)
const stageRoot = path.join(outDir, 'stage')
const stageDir = path.join(stageRoot, archiveBase)

const log = (message) => console.log(`[build-release] ${message}`)
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

log(`building ${archiveBase} (node ${process.version})`)
fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(stageDir, { recursive: true })

// 1. server: compile TypeScript, copy migrations (plain SQL, not emitted by tsc)
const serverStage = path.join(stageDir, 'server')
const distStage = path.join(serverStage, 'dist')
fs.mkdirSync(serverStage, { recursive: true })
run(npm, ['exec', '--', 'tsc', '-p', 'tsconfig.build.json', '--outDir', distStage], {
  cwd: serverDir,
  shell: process.platform === 'win32',
})
fs.cpSync(path.join(serverDir, 'src', 'db', 'migrations'), path.join(distStage, 'db', 'migrations'), {
  recursive: true,
  filter: (source) => !source.endsWith('.gitkeep'),
})

// 2. production dependencies. --ignore-scripts: the lockfile has no `hasInstallScript` flag for
// better-sqlite3, so npm would otherwise run `node-gyp rebuild` and need a C++ toolchain (absent on
// Windows runners). It ships N-API prebuilds for every platform, which is all it needs at runtime.
fs.writeFileSync(
  path.join(serverStage, 'package.json'),
  JSON.stringify({ ...serverPackage, version, scripts: undefined, devDependencies: undefined }, null, 2),
)
fs.copyFileSync(path.join(serverDir, 'package-lock.json'), path.join(serverStage, 'package-lock.json'))
run(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: serverStage,
  shell: process.platform === 'win32',
})

// 3. web app
const webStage = path.join(stageDir, 'web')
if (values['skip-web']) {
  fs.mkdirSync(webStage, { recursive: true })
  fs.writeFileSync(path.join(webStage, 'index.html'), '<!doctype html><title>web build skipped</title>')
} else {
  run(npm, ['run', 'build'], { cwd: repoRoot, shell: process.platform === 'win32' })
  fs.cpSync(path.join(repoRoot, 'dist'), webStage, { recursive: true })
}

// 4. runtime: the very binary that is running this script
const runtimeDir = path.join(stageDir, 'runtime')
fs.mkdirSync(runtimeDir, { recursive: true })
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
fs.copyFileSync(process.execPath, path.join(runtimeDir, nodeName))
fs.chmodSync(path.join(runtimeDir, nodeName), 0o755)

// 4b. support command (`qlcn status|restore|doctor...`), for this platform only
const binSource = path.join(serverDir, 'packaging', 'bin')
const binStage = path.join(stageDir, 'bin')
fs.mkdirSync(binStage, { recursive: true })
if (process.platform === 'win32') {
  fs.copyFileSync(path.join(binSource, 'qlcn.cmd'), path.join(binStage, 'qlcn.cmd'))
  // Windows PowerShell 5.1 reads a BOM-less script as ANSI, which garbles the Vietnamese messages.
  const script = fs.readFileSync(path.join(binSource, 'qlcn.ps1'), 'utf8').replace(/^﻿/, '')
  fs.writeFileSync(path.join(binStage, 'qlcn.ps1'), `﻿${script}`)
} else {
  fs.copyFileSync(path.join(binSource, 'qlcn'), path.join(binStage, 'qlcn'))
  fs.chmodSync(path.join(binStage, 'qlcn'), 0o755)
}

// 5. metadata
fs.writeFileSync(
  path.join(stageDir, 'version.json'),
  JSON.stringify(
    {
      version,
      platform: platformKey,
      node: process.version,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
)

if (values['simulate-broken']) {
  const main = path.join(distStage, 'main.js')
  fs.writeFileSync(main, `process.exit(1)\n${fs.readFileSync(main, 'utf8')}`)
  log('simulate-broken: main.js now exits immediately')
}

// 6. archive: tar.gz works on macOS, Linux and Windows 10+ (bsdtar ships with Windows)
const archivePath = path.join(outDir, `${archiveBase}.tar.gz`)
fs.rmSync(archivePath, { force: true })
// On Windows, name the system bsdtar explicitly: Git's GNU tar can come first on PATH and reads
// `D:\path` as a remote host.
const tar =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
run(tar, ['-czf', archivePath, '-C', stageRoot, archiveBase])

const sha256 = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
const size = fs.statSync(archivePath).size
fs.writeFileSync(
  path.join(outDir, `${archiveBase}.json`),
  JSON.stringify({ version, platform: platformKey, file: path.basename(archivePath), sha256, size }, null, 2),
)

fs.rmSync(stageRoot, { recursive: true, force: true })
log(`done: ${archivePath} (${(size / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}...)`)
