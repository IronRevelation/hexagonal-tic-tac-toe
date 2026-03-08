import { useEffect, useState } from 'react'
import type { GameClockSnapshot } from '../../shared/contracts'
import type { PlayerSlot } from '../../shared/hexGame'

export type LiveClockState = {
  remainingMs: Record<PlayerSlot, number>
  displayText: Record<PlayerSlot, string>
}

export function formatClock(
  remainingMs: number,
  options?: {
    showTenths?: boolean
  },
) {
  const clampedMs = Math.max(0, remainingMs)
  const showTenths = options?.showTenths ?? clampedMs < 60_000

  if (showTenths) {
    const totalSeconds = Math.floor(clampedMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = Math.floor(clampedMs / 1000)
    const tenths = Math.floor((clampedMs % 1000) / 100)
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}.${tenths}`
  }

  const totalSeconds = Math.floor(clampedMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function resolveLiveClockState(
  clock: GameClockSnapshot,
  clientNow: number,
): LiveClockState {
  const elapsedMs =
    clock.activePlayer === null ? 0 : Math.max(0, clientNow - clock.serverNow)
  const remainingMs = {
    one:
      clock.activePlayer === 'one'
        ? Math.max(0, clock.remainingMs.one - elapsedMs)
        : clock.remainingMs.one,
    two:
      clock.activePlayer === 'two'
        ? Math.max(0, clock.remainingMs.two - elapsedMs)
        : clock.remainingMs.two,
  } satisfies Record<PlayerSlot, number>

  return {
    remainingMs,
    displayText: {
      one: formatClock(remainingMs.one, {
        showTenths: clock.activePlayer === 'one',
      }),
      two: formatClock(remainingMs.two, {
        showTenths: clock.activePlayer === 'two',
      }),
    },
  }
}

export function useGameClock(clock: GameClockSnapshot | null) {
  const [serverOffsetMs, setServerOffsetMs] = useState(() =>
    clock ? clock.serverNow - Date.now() : 0,
  )
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!clock) {
      setServerOffsetMs(0)
      return
    }

    setServerOffsetMs(clock.serverNow - Date.now())
  }, [clock])

  useEffect(() => {
    if (!clock || clock.activePlayer === null) {
      return
    }

    let frameId = 0

    const tick = () => {
      setTick((tick) => tick + 1)
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [clock])

  if (!clock) {
    return null
  }

  return resolveLiveClockState(clock, Date.now() + serverOffsetMs)
}
