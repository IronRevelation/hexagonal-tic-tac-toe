import { useEffect } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { asGameId } from './ids'

const HEARTBEAT_MS = 10_000

type BindVisibleHeartbeatOptions = {
  heartbeat: () => void
  getVisibilityState: () => DocumentVisibilityState
  addWindowListener: typeof window.addEventListener
  removeWindowListener: typeof window.removeEventListener
  addDocumentListener: typeof document.addEventListener
  removeDocumentListener: typeof document.removeEventListener
  setIntervalFn: typeof window.setInterval
  clearIntervalFn: typeof window.clearInterval
}

export function useVisibleHeartbeat(
  guestToken: string | null,
  gameId?: string | null,
) {
  const heartbeat = useMutation(api.guests.heartbeat)

  useEffect(() => {
    if (!guestToken || typeof document === 'undefined') {
      return
    }

    return bindVisibleHeartbeat({
      heartbeat: () => {
        void heartbeat({
          guestToken,
          gameId: gameId ? asGameId(gameId) : undefined,
        }).catch(() => {
          // Presence is best effort.
        })
      },
      getVisibilityState: () => document.visibilityState,
      addWindowListener: window.addEventListener.bind(window),
      removeWindowListener: window.removeEventListener.bind(window),
      addDocumentListener: document.addEventListener.bind(document),
      removeDocumentListener: document.removeEventListener.bind(document),
      setIntervalFn: window.setInterval.bind(window),
      clearIntervalFn: window.clearInterval.bind(window),
    })
  }, [gameId, guestToken, heartbeat])
}

export function bindVisibleHeartbeat({
  heartbeat,
  getVisibilityState,
  addWindowListener,
  removeWindowListener,
  addDocumentListener,
  removeDocumentListener,
  setIntervalFn,
  clearIntervalFn,
}: BindVisibleHeartbeatOptions) {
  let intervalId: number | null = null

  const ping = () => {
    heartbeat()
  }

  const stop = () => {
    if (intervalId !== null) {
      clearIntervalFn(intervalId)
      intervalId = null
    }
  }

  const start = () => {
    stop()
    ping()
    intervalId = setIntervalFn(ping, HEARTBEAT_MS)
  }

  const syncWithVisibility = () => {
    if (getVisibilityState() === 'visible') {
      start()
      return
    }

    stop()
  }

  const handleVisibilityChange = () => {
    syncWithVisibility()
  }

  const handleFocus = () => {
    if (getVisibilityState() === 'visible') {
      start()
    }
  }

  syncWithVisibility()
  addWindowListener('focus', handleFocus)
  addDocumentListener('visibilitychange', handleVisibilityChange)

  return () => {
    stop()
    removeWindowListener('focus', handleFocus)
    removeDocumentListener('visibilitychange', handleVisibilityChange)
  }
}
