import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { GuestSession } from '../../shared/contracts'

type GuestSessionContextValue = {
  guestToken: string | null
  session: GuestSession | null
  isReady: boolean
  isLoading: boolean
  error: string | null
  ensureGuestSession: () => Promise<string>
  clearGuestSession: () => void
}

const GuestSessionContext = createContext<GuestSessionContextValue | null>(null)
const GUEST_TOKEN_KEY = 'hexagonal-ttt-guest-token'
const GUEST_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type GuestTokenReader = Pick<Storage, 'getItem' | 'removeItem'>
type GuestTokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function loadStoredGuestToken(storage: GuestTokenReader) {
  const storedToken = storage.getItem(GUEST_TOKEN_KEY)
  if (storedToken && GUEST_TOKEN_PATTERN.test(storedToken)) {
    return storedToken
  }
  if (storedToken) {
    storage.removeItem(GUEST_TOKEN_KEY)
  }
  return null
}

export function ensureStoredGuestToken(
  storage: GuestTokenStorage,
  createGuestToken: () => string,
) {
  const existingToken = loadStoredGuestToken(storage)
  if (existingToken) {
    return existingToken
  }

  const nextToken = createGuestToken()
  storage.setItem(GUEST_TOKEN_KEY, nextToken)
  return nextToken
}

export function getClientStoredGuestToken() {
  if (typeof window === 'undefined') {
    return null
  }

  return loadStoredGuestToken(window.localStorage)
}

export function GuestSessionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [guestToken, setGuestToken] = useState<string | null>(null)
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false)
  const [isEnsuring, setIsEnsuring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guestTokenRef = useRef<string | null>(null)
  const ensureInFlightRef = useRef<Promise<string> | null>(null)
  const ensureGuest = useMutation(api.guests.ensure)

  useEffect(() => {
    const storedToken = loadStoredGuestToken(window.localStorage)
    if (storedToken) {
      setGuestToken(storedToken)
    }
    setHasLoadedStorage(true)
  }, [])

  useEffect(() => {
    guestTokenRef.current = guestToken
  }, [guestToken])

  const session = useQuery(
    api.guests.session,
    guestToken ? { guestToken } : 'skip',
  )

  useEffect(() => {
    if (!hasLoadedStorage || isEnsuring || !guestToken || session !== null) {
      return
    }

    clearGuestSession()
  }, [guestToken, hasLoadedStorage, isEnsuring, session])

  async function ensureGuestSession() {
    if (ensureInFlightRef.current) {
      return ensureInFlightRef.current
    }

    const operation = (async () => {
      let token = guestTokenRef.current
      if (!token) {
        token = ensureStoredGuestToken(window.localStorage, () => crypto.randomUUID())
        guestTokenRef.current = token
        setGuestToken(token)
      }

      setIsEnsuring(true)
      setError(null)

      try {
        await ensureGuest({ guestToken: token })
        return token
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to create a guest session.',
        )
        throw cause
      } finally {
        setIsEnsuring(false)
        ensureInFlightRef.current = null
      }
    })()

    ensureInFlightRef.current = operation
    return operation
  }

  function clearGuestSession() {
    window.localStorage.removeItem(GUEST_TOKEN_KEY)
    guestTokenRef.current = null
    setGuestToken(null)
    setError(null)
  }

  return (
    <GuestSessionContext.Provider
      value={{
        guestToken,
        session: session ?? null,
        isReady: hasLoadedStorage,
        isLoading:
          !hasLoadedStorage ||
          isEnsuring ||
          (guestToken !== null && session === undefined),
        error,
        ensureGuestSession,
        clearGuestSession,
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
