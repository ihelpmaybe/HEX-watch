/** Public HEX token / staking contract (Ethereum + PulseChain). */
export const HEX_ADDRESS = '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39' as const

/** Minimal read ABI from verified public contract source. */
export const HEX_READ_ABI = [
  {
    type: 'function',
    name: 'currentDay',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'stakeCount',
    stateMutability: 'view',
    inputs: [{ name: 'stakerAddr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'stakeLists',
    stateMutability: 'view',
    inputs: [
      { name: 'stakerAddr', type: 'address' },
      { name: 'stakeIndex', type: 'uint256' },
    ],
    outputs: [
      { name: 'stakeId', type: 'uint40' },
      { name: 'stakedHearts', type: 'uint72' },
      { name: 'stakeShares', type: 'uint72' },
      { name: 'lockedDay', type: 'uint16' },
      { name: 'stakedDays', type: 'uint16' },
      { name: 'unlockedDay', type: 'uint16' },
      { name: 'isAutoStake', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'dailyDataRange',
    stateMutability: 'view',
    inputs: [
      { name: 'beginDay', type: 'uint256' },
      { name: 'endDay', type: 'uint256' },
    ],
    outputs: [{ name: 'dataList', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'stakeEnd',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'stakeIndex', type: 'uint256' },
      { name: 'stakeIdParam', type: 'uint40' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'globals',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'lockedHeartsTotal', type: 'uint72' },
      { name: 'nextStakeSharesTotal', type: 'uint72' },
      { name: 'shareRate', type: 'uint40' },
      { name: 'stakePenaltyTotal', type: 'uint72' },
      { name: 'dailyDataCount', type: 'uint16' },
      { name: 'stakeSharesTotal', type: 'uint72' },
      { name: 'latestStakeId', type: 'uint40' },
      { name: 'claimStats', type: 'uint128' },
    ],
  },
] as const

/** HEX stake lifecycle events (packed data0/data1 — see public HEX event layout). */
export const HEX_EVENT_ABI = [
  {
    type: 'event',
    name: 'StakeStart',
    inputs: [
      { name: 'data0', type: 'uint256', indexed: false },
      { name: 'stakerAddr', type: 'address', indexed: true },
      { name: 'stakeId', type: 'uint40', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'StakeEnd',
    inputs: [
      { name: 'data0', type: 'uint256', indexed: false },
      { name: 'data1', type: 'uint256', indexed: false },
      { name: 'stakerAddr', type: 'address', indexed: true },
      { name: 'stakeId', type: 'uint40', indexed: true },
    ],
  },
] as const

export const HSIM_ADDRESS = '0x8BD3d1472A656e312E94fB1BbdD599B8C51D18e3' as const
export const HDRN_ADDRESS = '0x3819f64f282bf135d62168C1e513280dAF905e06' as const

/** Communis — HEX staker incentive (same address on Ethereum + PulseChain). */
export const COM_ADDRESS = '0x5A9780Bfe63f3ec57f01b087cD65BD656C9034A8' as const
export const COM_DECIMALS = 12

export const COM_READ_ABI = [
  {
    type: 'function',
    name: 'stakeIdStartBonusPayout',
    stateMutability: 'view',
    inputs: [{ name: 'stakeId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'stakeIdEndBonusPayout',
    stateMutability: 'view',
    inputs: [{ name: 'stakeId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPayout',
    stateMutability: 'pure',
    inputs: [
      {
        name: 's',
        type: 'tuple',
        components: [
          { name: 'stakeID', type: 'uint256' },
          { name: 'stakedHearts', type: 'uint256' },
          { name: 'stakeShares', type: 'uint256' },
          { name: 'lockedDay', type: 'uint256' },
          { name: 'stakedDays', type: 'uint256' },
          { name: 'unlockedDay', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      {
        name: 'pr',
        type: 'tuple',
        components: [
          { name: 'recalculatedStakeShares', type: 'uint256' },
          { name: 'stakesOriginalShareRate', type: 'uint256' },
          { name: 'maxPayout', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getStartBonusPayout',
    stateMutability: 'pure',
    inputs: [
      { name: 'stakedDays', type: 'uint256' },
      { name: 'lockedDay', type: 'uint256' },
      { name: 'maxPayout', type: 'uint256' },
      { name: 'stakesOriginalShareRate', type: 'uint256' },
      { name: 'currentDay', type: 'uint256' },
      { name: 'globalShareRate', type: 'uint256' },
      { name: 'applyRestakeBonus', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Hedron share / mint reads (same address on Ethereum + PulseChain). */
export const HDRN_READ_ABI = [
  {
    type: 'function',
    name: 'shareList',
    stateMutability: 'view',
    inputs: [{ name: 'stakeId', type: 'uint256' }],
    outputs: [
      {
        name: 'stake',
        type: 'tuple',
        components: [
          { name: 'stakeId', type: 'uint40' },
          { name: 'stakeShares', type: 'uint72' },
          { name: 'lockedDay', type: 'uint16' },
          { name: 'stakedDays', type: 'uint16' },
        ],
      },
      { name: 'mintedDays', type: 'uint16' },
      { name: 'launchBonus', type: 'uint8' },
      { name: 'loanStart', type: 'uint16' },
      { name: 'loanedDays', type: 'uint16' },
      { name: 'interestRate', type: 'uint32' },
      { name: 'paymentsMade', type: 'uint8' },
      { name: 'isLoaned', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'dailyDataList',
    stateMutability: 'view',
    inputs: [{ name: 'day', type: 'uint256' }],
    outputs: [
      { name: 'dayMintedTotal', type: 'uint72' },
      { name: 'dayLoanedTotal', type: 'uint72' },
      { name: 'dayBurntTotal', type: 'uint72' },
      { name: 'interestRate', type: 'uint32' },
      { name: 'dayMintMultiplier', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'currentDay',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const HSIM_ABI = [
  {
    type: 'function',
    name: 'hsiCount',
    stateMutability: 'view',
    inputs: [{ name: 'hsiOwner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'hsiLists',
    stateMutability: 'view',
    inputs: [
      { name: 'hsiOwner', type: 'address' },
      { name: 'hsiIndex', type: 'uint256' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenOfOwnerByIndex',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'hsiToken',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

export const HSI_ABI = [
  {
    type: 'function',
    name: 'stakeId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint40' }],
  },
  {
    type: 'function',
    name: 'getStake',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'stakeId', type: 'uint40' },
      { name: 'stakedHearts', type: 'uint72' },
      { name: 'stakeShares', type: 'uint72' },
      { name: 'lockedDay', type: 'uint16' },
      { name: 'stakedDays', type: 'uint16' },
      { name: 'unlockedDay', type: 'uint16' },
      { name: 'isAutoStake', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'share',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'stake',
        type: 'tuple',
        components: [
          { name: 'stakeId', type: 'uint40' },
          { name: 'stakeShares', type: 'uint72' },
          { name: 'lockedDay', type: 'uint16' },
          { name: 'stakedDays', type: 'uint16' },
        ],
      },
      { name: 'mintedDays', type: 'uint16' },
      { name: 'launchBonus', type: 'uint8' },
      { name: 'loanStart', type: 'uint16' },
      { name: 'loanedDays', type: 'uint16' },
      { name: 'interestRate', type: 'uint32' },
      { name: 'paymentsMade', type: 'uint8' },
      { name: 'isLoaned', type: 'bool' },
    ],
  },
] as const

export type ChainKey = 'ethereum' | 'pulsechain'

/** Approximate deploy / useful scan starts for log chunking. */
export const HEX_LOG_FROM_BLOCK: Record<ChainKey, bigint> = {
  ethereum: 9_082_930n,
  pulsechain: 0n,
}

export interface ChainConfig {
  key: ChainKey
  label: string
  chainId: number
  explorerStake?: (address: string) => string
  rpcUrls: string[]
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: 'ethereum',
    label: 'Ethereum',
    chainId: 1,
    explorerStake: (address) => `https://etherscan.io/address/${address}`,
    rpcUrls: [
      // Prefer RPCs that allow historical eth_getLogs (PublicNode needs archive token).
      'https://rpc.mevblocker.io',
      'https://eth.drpc.org',
      'https://ethereum-rpc.publicnode.com',
      'https://ethereum.publicnode.com',
    ],
  },
  pulsechain: {
    key: 'pulsechain',
    label: 'PulseChain',
    chainId: 369,
    explorerStake: (address) => `https://scan.pulsechain.com/address/${address}`,
    rpcUrls: [
      'https://pulsechain-rpc.publicnode.com',
      'https://pulsechain.publicnode.com',
      'https://rpc-pulsechain.g4mm4.io',
      'https://rpc.pulsechain.com',
    ],
  },
}
