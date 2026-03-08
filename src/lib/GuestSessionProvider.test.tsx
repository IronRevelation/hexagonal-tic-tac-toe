import { describe, expect, it, vi } from 'vitest'
import { ensureStoredGuestToken, loadStoredGuestToken } from './GuestSessionProvider'

describe('GuestSessionProvider token helpers', () => {
  it('reads an existing valid token without creating a new one', () => {
    const storage = {
      getItem: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
      removeItem: vi.fn(),
    }

    expect(loadStoredGuestToken(storage)).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('removes malformed stored tokens instead of using them', () => {
    const storage = {
      getItem: vi.fn(() => 'not-a-token'),
      removeItem: vi.fn(),
    }

    expect(loadStoredGuestToken(storage)).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith('hexagonal-ttt-guest-token')
  })

  it('creates and persists a token only when explicitly ensured', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    const token = ensureStoredGuestToken(
      storage,
      () => '123e4567-e89b-42d3-a456-426614174000',
    )

    expect(token).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(storage.setItem).toHaveBeenCalledWith(
      'hexagonal-ttt-guest-token',
      '123e4567-e89b-42d3-a456-426614174000',
    )
  })
})
