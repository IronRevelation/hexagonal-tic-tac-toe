import type { Id } from '../../convex/_generated/dataModel'

export function asGameId(value: string): Id<'games'> {
  return value as Id<'games'>
}
