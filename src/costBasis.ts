import type { ChainKey } from './hex'

const STORAGE_KEY = 'hex-watch/cost-basis/v1'

export type CostBasisMap = Record<string, number>

export function costBasisKey(chain: ChainKey, stakeId: number): string {
  return `${chain}:${stakeId}`
}

export function loadCostBasis(): CostBasisMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return normalizeCostBasisMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** Sanitize unknown JSON into a cost-basis map. */
export function normalizeCostBasisMap(raw: unknown): CostBasisMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CostBasisMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(ethereum|pulsechain):\d+$/.test(k)) continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) out[k] = n
  }
  return out
}

export function saveCostBasis(map: CostBasisMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function replaceCostBasis(map: CostBasisMap): CostBasisMap {
  const next = normalizeCostBasisMap(map)
  saveCostBasis(next)
  return next
}

export function setCostBasisEntry(
  map: CostBasisMap,
  chain: ChainKey,
  stakeId: number,
  usd: number | null,
): CostBasisMap {
  const next = { ...map }
  const key = costBasisKey(chain, stakeId)
  if (usd == null || !Number.isFinite(usd) || usd < 0) delete next[key]
  else next[key] = usd
  saveCostBasis(next)
  return next
}

export function getCostBasis(
  map: CostBasisMap,
  chain: ChainKey,
  stakeId: number,
): number | null {
  const n = map[costBasisKey(chain, stakeId)]
  return n != null && Number.isFinite(n) ? n : null
}
