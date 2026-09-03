import { isAddress, type Address } from 'viem'
import { normalizeCostBasisMap, type CostBasisMap } from './costBasis'
import type { WatchedAddress } from './data'

export const BACKUP_VERSION = 1

export interface LocalBackup {
  version: number
  exportedAt: string
  watchlist: WatchedAddress[]
  costBasis: CostBasisMap
}

export function buildLocalBackup(
  watchlist: WatchedAddress[],
  costBasis: CostBasisMap,
): LocalBackup {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    watchlist,
    costBasis,
  }
}

function asAddress(raw: unknown): Address {
  if (typeof raw !== 'string' || !isAddress(raw)) {
    throw new Error('Backup has an invalid address.')
  }
  return raw
}

/** Parse export JSON into a restoreable backup. */
export function parseLocalBackup(raw: unknown): LocalBackup {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup file is not valid JSON.')
  }
  const obj = raw as Record<string, unknown>
  const watchRaw = obj.watchlist
  const costRaw = obj.costBasis

  if (watchRaw == null && costRaw == null) {
    throw new Error('Backup needs a watchlist and/or costBasis.')
  }

  let watchlist: WatchedAddress[] = []
  if (watchRaw != null) {
    if (!Array.isArray(watchRaw)) throw new Error('watchlist must be an array.')
    watchlist = watchRaw.map((entry, i) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`watchlist[${i}] is invalid.`)
      }
      const row = entry as Record<string, unknown>
      const address = asAddress(row.address)
      const label =
        typeof row.label === 'string' && row.label.trim()
          ? row.label.trim().slice(0, 64)
          : `${address.slice(0, 6)}…${address.slice(-4)}`
      const id =
        typeof row.id === 'string' && row.id.trim() ? row.id : crypto.randomUUID()
      const createdAt =
        typeof row.createdAt === 'string' && row.createdAt
          ? row.createdAt
          : new Date().toISOString()
      return { id, address, label, createdAt }
    })
  }

  const costBasis = costRaw != null ? normalizeCostBasisMap(costRaw) : {}

  return {
    version: typeof obj.version === 'number' ? obj.version : BACKUP_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    watchlist,
    costBasis,
  }
}
