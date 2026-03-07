import { createContext, useContext, useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { GuestSession } from '../../shared/contracts'

type GuestSessionContextValue = {
  guestToken: string | null
  session: GuestSession | null
  isReady: boolean
  isLoading: boolean
  error: string | null
}

const GuestSessionContext = createContext<GuestSessionContextValue | null>(null)
const GUEST_TOKEN_KEY = 'hexagonal-ttt-guest-token'

export function GuestSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const [isEnsuring, setIsEnsuring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ensureGuest = useMutation(api.guests.ensure)

  useEffect(() => {
    const storedToken = window.localStorage.getItem(GUEST_TOKEN_KEY)
    if (storedToken) {
      setGuestToken(storedToken)
      return
    }

    const nextToken = crypto.randomUUID()
    window.localStorage.setItem(GUEST_TOKEN_KEY, nextToken)
    setGuestToken(nextToken)
  }, [])

  const session = useQuery(
    api.guests.session,
    guestToken ? { guestToken } : 'skip',
  )

  useEffect(() => {
    if (!guestToken) {
      return
    }

    let cancelled = false
    setIsEnsuring(true)
    setError(null)

    ensureGuest({ guestToken })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to create a guest session.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsEnsuring(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [ensureGuest, guestToken])

  return (
    <GuestSessionContext.Provider
      value={{
        guestToken,
        session: session ?? null,
        isReady: guestToken !== null,
        isLoading: guestToken === null || isEnsuring || session === undefined,
        error,
      }}
    >
      {children}
    </GuestSessionContext.Provider>
  )
}

export function useGuestSession() {
  const context = useContext(GuestSessionContext)

  if (!context) {
    throw new Error('useGuestSession must be used within GuestSessionProvider.')
  }

  return context
}
