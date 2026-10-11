import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Resolved relative to this file, so it works from src/ (tsx) and from a compiled dist/ next to package.json.
export const APP_VERSION: string = (require('../package.json') as { version: string }).version
