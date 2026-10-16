import { describe, expect, it } from 'vitest'
import { factsFromDiskutil } from './volumes.js'

// Shaped like the output of `diskutil info -plist`, reduced to the keys the app reads.
const plist = (values: Record<string, string | number | boolean>): string =>
  `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(values)
    .map(([key, value]) => {
      const rendered =
        typeof value === 'boolean' ? (value ? '<true/>' : '<false/>') : typeof value === 'number' ? `<integer>${value}</integer>` : `<string>${value}</string>`
      return `<key>${key}</key>${rendered}`
    })
    .join('')}</dict></plist>`

describe('volume facts', () => {
  it('accepts an external writable drive and reports its free space', () => {
    expect(
      factsFromDiskutil(plist({ BusProtocol: 'USB', Internal: false, Writable: true, VolumeFreeSpace: 420_000_000_000 })),
    ).toEqual({ eligible: true, freeBytes: 420_000_000_000 })
  })

  it('uses the container free space for APFS drives', () => {
    expect(
      factsFromDiskutil(plist({ BusProtocol: 'USB', Internal: false, Writable: true, APFSContainerFree: 5_000 })).freeBytes,
    ).toBe(5_000)
  })

  it('hides installer images such as a mounted .dmg', () => {
    expect(factsFromDiskutil(plist({ BusProtocol: 'Disk Image', Internal: false, Writable: true })).eligible).toBe(false)
  })

  it('hides read-only volumes, such as an NTFS drive on a Mac', () => {
    expect(factsFromDiskutil(plist({ BusProtocol: 'USB', Writable: false, WritableVolume: false })).eligible).toBe(false)
  })

  it('hides internal disks', () => {
    expect(factsFromDiskutil(plist({ BusProtocol: 'Apple Fabric', Internal: true, Writable: true })).eligible).toBe(false)
  })

  it('does not guess free space it was not told', () => {
    expect(factsFromDiskutil(plist({ BusProtocol: 'USB', Writable: true })).freeBytes).toBeNull()
  })
})
