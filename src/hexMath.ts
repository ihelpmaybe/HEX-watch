/** HEX launch day 0 = 2019-12-03 UTC (public protocol calendar). */
export const HEX_DAY_ZERO_MS = Date.UTC(2019, 11, 3)
export const HEARTS_PER_HEX = 100_000_000n
export const LATE_PENALTY_GRACE_DAYS = 14n
export const LATE_PENALTY_SCALE_DAYS = 700n
export const EARLY_PENALTY_MIN_DAYS = 90n
const MASK_72 = (1n << 72n) - 1n

export type StakeStatus = 'scheduled' | 'active' | 'mature' | 'late' | 'ended'

export function hexDayToDate(day: number): Date {
  return new Date(HEX_DAY_ZERO_MS + day * 86_400_000)
}

/** Calendar HEX day from UTC wall clock — no RPC. Day 0 = 2019-12-03. */
export function estimateHexDay(nowMs = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - HEX_DAY_ZERO_MS) / 86_400_000))
}

export function formatDayDate(day: number): string {
  return hexDayToDate(day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function heartsToHex(hearts: bigint): number {
  return Number(hearts) / 1e8
}

export function formatHexAmount(hearts: bigint, digits = 2): string {
  return heartsToHex(hearts).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })
}

export function deriveStatus(
  currentDay: bigint,
  lockedDay: bigint,
  stakedDays: bigint,
  unlockedDay: bigint,
): StakeStatus {
  if (unlockedDay > 0n) return 'ended'
  const endDay = lockedDay + stakedDays
  const graceEnd = endDay + LATE_PENALTY_GRACE_DAYS
  if (currentDay < lockedDay) return 'scheduled'
  if (currentDay < endDay) return 'active'
  if (currentDay <= graceEnd) return 'mature'
  return 'late'
}

export function servedDays(currentDay: bigint, lockedDay: bigint, stakedDays: bigint): bigint {
  if (currentDay <= lockedDay) return 0n
  const served = currentDay - lockedDay
  return served > stakedDays ? stakedDays : served
}

export function earlyPenaltyDays(stakedDays: bigint): bigint {
  const halfRoundedUp = (stakedDays + 1n) / 2n
  return halfRoundedUp > EARLY_PENALTY_MIN_DAYS ? halfRoundedUp : EARLY_PENALTY_MIN_DAYS
}

export function estimateEarlyPenalty(
  principal: bigint,
  payout: bigint,
  stakedDays: bigint,
  served: bigint,
): bigint {
  const penaltyDays = earlyPenaltyDays(stakedDays)
  const raw = principal + payout
  // Day-0 / not yet served: early-end can consume the whole stake.
  if (served === 0n) return raw
  const scaled = (payout * penaltyDays) / served
  return scaled > raw ? raw : scaled
}

export function estimateLatePenalty(rawReturn: bigint, currentDay: bigint, lockedDay: bigint, stakedDays: bigint): bigint {
  const lateStart = lockedDay + stakedDays + LATE_PENALTY_GRACE_DAYS
  const lateDays = currentDay > lateStart ? currentDay - lateStart : 0n
  if (lateDays === 0n) return 0n
  const penalty = (rawReturn * lateDays) / LATE_PENALTY_SCALE_DAYS
  return penalty > rawReturn ? rawReturn : penalty
}

export function decodeDailyPayout(packed: bigint, stakeShares: bigint): bigint {
  const payoutTotal = packed & MASK_72
  const shareTotal = (packed >> 72n) & MASK_72
  if (shareTotal === 0n) return 0n
  return (payoutTotal * stakeShares) / shareTotal
}

export function annualizedPct(principalHearts: bigint, payoutHearts: bigint, served: bigint): number | null {
  if (principalHearts <= 0n || served <= 0n) return null
  const roi = Number(payoutHearts) / Number(principalHearts)
  return roi * (365 / Number(served)) * 100
}
