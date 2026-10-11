#!/usr/bin/env node
// Release manifest tooling: key generation, signing, verification and installer rendering.
//
//   node packaging/manifest.mjs keygen <name> [--dir <dir>]
//   node packaging/manifest.mjs publish --dir <release dir> --base-url <url> --key <private.pem>
//                                       --public-key <public.pem> [--public-key <backup.pem>]
//                                       [--notes "..."]
//   node packaging/manifest.mjs verify --dir <release dir> --public-key <public.pem>
//
// Signatures are ECDSA P-256 + SHA-256. (Ed25519 was the original choice, but neither Windows
// PowerShell 5.1 nor the LibreSSL that ships with macOS can verify it, and the installer has to
// verify the manifest *before* anything from the download is allowed to run.)
//
// The private key must never be committed. Public keys are baked into the rendered installers
// and into the app, so a compromised download host cannot push a malicious update.

import {
  createPublicKey,
  generateKeyPairSync,
  sign as signData,
  verify as verifyData,
} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const packagingDir = path.dirname(fileURLToPath(import.meta.url))
const [command, ...rest] = process.argv.slice(2)

const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    'base-url': { type: 'string' },
    key: { type: 'string' },
    'public-key': { type: 'string', multiple: true },
    notes: { type: 'string', default: '' },
  },
})

/** X || Y of a P-256 public key, base64: what the PowerShell installer imports as a CNG blob. */
function rawPublicKey(pem) {
  const jwk = createPublicKey(pem).export({ format: 'jwk' })
  const x = Buffer.from(jwk.x, 'base64url')
  const y = Buffer.from(jwk.y, 'base64url')
  return Buffer.concat([x, y]).toString('base64')
}

function keygen() {
  const name = positionals[0]
  if (!name) throw new Error('usage: keygen <name> [--dir <dir>]')
  const dir = path.resolve(values.dir ?? '.')
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

  const privatePath = path.join(dir, `${name}.private.pem`)
  const publicPath = path.join(dir, `${name}.public.pem`)
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }))
  console.log(`private key (keep secret, back it up offline): ${privatePath}`)
  console.log(`public key: ${publicPath}`)
}

function metasIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => /^qlcn-.*\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
}

function publish() {
  const dir = path.resolve(values.dir ?? '')
  const baseUrl = (values['base-url'] ?? '').replace(/\/+$/, '')
  const publicKeys = (values['public-key'] ?? []).map((file) => fs.readFileSync(file, 'utf8'))
  if (!values.dir || !baseUrl || !values.key || publicKeys.length === 0) {
    throw new Error('usage: publish --dir <dir> --base-url <url> --key <private.pem> --public-key <pem>...')
  }

  const metas = metasIn(dir)
  if (metas.length === 0) throw new Error(`no qlcn-*.json build metadata in ${dir}`)
  const versions = new Set(metas.map((meta) => meta.version))
  if (versions.size !== 1) throw new Error(`mixed versions in ${dir}: ${[...versions].join(', ')}`)

  const manifest = {
    version: metas[0].version,
    releasedAt: new Date().toISOString(),
    notes: values.notes,
    files: Object.fromEntries(
      metas.map((meta) => [
        meta.platform,
        { url: `${baseUrl}/${meta.file}`, sha256: meta.sha256, size: meta.size },
      ]),
    ),
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  const privatePem = fs.readFileSync(values.key, 'utf8')

  fs.writeFileSync(path.join(dir, 'manifest.json'), manifestBytes)
  // DER for `openssl dgst -verify` (macOS); raw r||s for .NET and for the app itself.
  fs.writeFileSync(
    path.join(dir, 'manifest.sig.der'),
    signData('sha256', manifestBytes, { key: privatePem, dsaEncoding: 'der' }),
  )
  fs.writeFileSync(
    path.join(dir, 'manifest.sig'),
    signData('sha256', manifestBytes, { key: privatePem, dsaEncoding: 'ieee-p1363' }).toString('base64'),
  )

  // Installers carry the public keys and the download location.
  const render = (templateName, outName, replacements) => {
    let text = fs.readFileSync(path.join(packagingDir, templateName), 'utf8')
    for (const [token, value] of Object.entries(replacements)) text = text.replaceAll(token, value)
    fs.writeFileSync(path.join(dir, outName), text, { mode: 0o755 })
  }
  render('install.sh.template', 'install.sh', {
    __BASE_URL__: baseUrl,
    __PUBLIC_KEYS_PEM__: publicKeys.map((pem) => pem.trim()).join('\n'),
  })
  render('install.ps1.template', 'install.ps1', {
    __BASE_URL__: baseUrl,
    __PUBLIC_KEYS_RAW__: publicKeys.map((pem) => `'${rawPublicKey(pem)}'`).join(', '),
  })

  console.log(`published ${manifest.version}: ${Object.keys(manifest.files).join(', ')}`)
  console.log(`  ${path.join(dir, 'manifest.json')} (+ .sig, .sig.der), install.sh, install.ps1`)
}

function verify() {
  const dir = path.resolve(values.dir ?? '')
  const keys = (values['public-key'] ?? []).map((file) => fs.readFileSync(file, 'utf8'))
  const manifest = fs.readFileSync(path.join(dir, 'manifest.json'))
  const signature = Buffer.from(fs.readFileSync(path.join(dir, 'manifest.sig'), 'utf8'), 'base64')
  const ok = keys.some((key) =>
    verifyData('sha256', manifest, { key, dsaEncoding: 'ieee-p1363' }, signature),
  )
  console.log(ok ? 'signature OK' : 'signature INVALID')
  process.exit(ok ? 0 : 1)
}

const commands = { keygen, publish, verify }
if (!commands[command]) {
  console.error('commands: keygen | publish | verify')
  process.exit(1)
}
commands[command]()
