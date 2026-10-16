import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface VolumeFacts {
  /** True for a drive that can really hold backups: external, writable, not an installer image. */
  eligible: boolean
  freeBytes: number | null
}

/** Looks at one mounted volume. Replaced in tests, where there is no real `diskutil`. */
export type VolumeInspector = (volumePath: string) => Promise<VolumeFacts>

function plistValue(xml: string, key: string): string | number | boolean | null {
  const match = new RegExp(
    `<key>${key}</key>\\s*(<true/>|<false/>|<string>([^<]*)</string>|<integer>(-?\\d+)</integer>)`,
  ).exec(xml)
  if (!match) return null
  if (match[1] === '<true/>') return true
  if (match[1] === '<false/>') return false
  if (match[3] !== undefined) return Number(match[3])
  return match[2] ?? null
}

/**
 * macOS mounts everything under /Volumes: USB drives, but also the installer images people open
 * (.dmg), network shares and the startup disk. Only an external, writable, real drive makes sense
 * as a backup target, so everything else is hidden from the choice.
 */
export function factsFromDiskutil(plistXml: string): VolumeFacts {
  const isDiskImage = plistValue(plistXml, 'BusProtocol') === 'Disk Image'
  const isInternal = plistValue(plistXml, 'Internal') === true
  const writable = plistValue(plistXml, 'WritableVolume') ?? plistValue(plistXml, 'Writable')

  // APFS drives report free space for the whole container, other formats for the volume.
  const free = [plistValue(plistXml, 'VolumeFreeSpace'), plistValue(plistXml, 'APFSContainerFree')].find(
    (value): value is number => typeof value === 'number',
  )

  return {
    eligible: !isDiskImage && !isInternal && writable !== false,
    freeBytes: free ?? null,
  }
}

export const diskutilInspector: VolumeInspector = async (volumePath) => {
  const { stdout } = await run('diskutil', ['info', '-plist', volumePath], { timeout: 10_000 })
  return factsFromDiskutil(stdout)
}
