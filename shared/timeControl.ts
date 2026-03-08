export type TimeControlPreset = 'unlimited' | '1m' | '3m' | '5m' | '10m'
export type TimedTimeControlPreset = Exclude<TimeControlPreset, 'unlimited'>

export const TIME_CONTROL_PRESETS: ReadonlyArray<{
  value: TimeControlPreset
  label: string
  description: string
}> = [
  {
    value: 'unlimited',
    label: 'Unlimited',
    description: 'No clock',
  },
  {
    value: '1m',
    label: '1 min',
    description: 'Bullet',
  },
  {
    value: '3m',
    label: '3 min',
    description: 'Blitz',
  },
  {
    value: '5m',
    label: '5 min',
    description: 'Rapid',
  },
  {
    value: '10m',
    label: '10 min',
    description: 'Classical',
  },
] as const

export function getInitialClockMs(preset: TimeControlPreset): number | null {
  switch (preset) {
    case 'unlimited':
      return null
    case '1m':
      return 60_000
    case '3m':
      return 3 * 60_000
    case '5m':
      return 5 * 60_000
    case '10m':
      return 10 * 60_000
  }
}

