import { useEffect, useRef } from 'react'
import type { GameStatus, ParticipantRole } from '../../shared/contracts'
import {
  PRESENCE_TOKEN_REFRESH_BUFFER_MS,
  PRESENCE_TOUCH_MS,
} from '../../shared/presence'
import {
  markGamePresenceAway,
  mintPresenceToken,
  touchGamePresence,
} from '../server/presence'

type PresenceTokenState = {
  token: string
  expiresAt: number
}

export function shouldTrackGamePresence(
  guestToken: string | null,
  gameId: string | null | undefined,
  gameStatus: GameStatus | null | undefined,
  viewerRole: ParticipantRole | null | undefined,
  viewerCanMove: boolean | null | undefined,
) {
  return Boolean(
    guestToken &&
      gameId &&
      gameStatus === 'active' &&
      viewerCanMove &&
      (viewerRole === 'playerOne' || viewerRole === 'playerTwo'),
  )
}

export function useGamePresence(
  guestToken: string | null,
  gameId: string | null | undefined,
  gameStatus: GameStatus | null | undefined,
  viewerRole: ParticipantRole | null | undefined,
  viewerCanMove: boolean | null | undefined,
) {
  const tokenRef = useRef<PresenceTokenState | null>(null)
  const tokenPromiseRef = useRef<Promise<PresenceTokenState> | null>(null)
  const canTrack = shouldTrackGamePresence(
    guestToken,
    gameId,
    gameStatus,
    viewerRole,
    viewerCanMove,
  )

  useEffect(() => {
    if (!canTrack || !guestToken || !gameId) {
      tokenRef.current = null
      tokenPromiseRef.current = null
      return
    }

    const ensureToken = async () => {
      const current = tokenRef.current
      if (
        current &&
        current.expiresAt - Date.now() > PRESENCE_TOKEN_REFRESH_BUFFER_MS
      ) {
        return current
      }

      if (tokenPromiseRef.current) {
        return tokenPromiseRef.current
      }

      const nextPromise = mintPresenceToken({
        data: { guestToken, gameId },
      })
        .then((nextToken: Awaited<ReturnType<typeof mintPresenceToken>>) => {
          const resolved = {
            token: nextToken.token,
            expiresAt: nextToken.expiresAt,
          }
          tokenRef.current = resolved
          tokenPromiseRef.current = null
          return resolved
        })
        .catch((_cause: unknown) => {
          tokenPromiseRef.current = null
          throw _cause
        })

      tokenPromiseRef.current = nextPromise
      return nextPromise
    }

    const isActivelyViewingGame = () =>
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      navigator.onLine !== false

    const touchIfVisible = async () => {
      if (!isActivelyViewingGame()) {
        return
      }

      try {
        const { token } = await ensureToken()
        await touchGamePresence({
          data: {
            token,
            gameId,
          },
        })
      } catch {
        // Presence is best effort.
      }
    }

    const markAwayWithCurrentToken = async () => {
      const currentToken = tokenRef.current
      if (!currentToken) {
        return
      }

      try {
        await markGamePresenceAway({
          data: {
            token: currentToken.token,
            gameId,
          },
        })
      } catch {
        // Presence is best effort.
      }
    }

    const syncPresence = () => {
      if (isActivelyViewingGame()) {
        void touchIfVisible()
      } else {
        void markAwayWithCurrentToken()
      }
    }

    syncPresence()

    const touchIntervalId = window.setInterval(() => {
      void touchIfVisible()
    }, PRESENCE_TOUCH_MS)

    const handleVisibilityChange = () => {
      syncPresence()
    }
    const handleFocus = () => {
      syncPresence()
    }
    const handleBlur = () => {
      void markAwayWithCurrentToken()
    }
    const handleOnline = () => {
      syncPresence()
    }
    const handleOffline = () => {
      void markAwayWithCurrentToken()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.clearInterval(touchIntervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      void markAwayWithCurrentToken()
    }
  }, [
    canTrack,
    gameId,
    guestToken,
    viewerCanMove,
  ])
}
