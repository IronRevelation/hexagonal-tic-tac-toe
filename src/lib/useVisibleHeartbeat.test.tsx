// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindVisibleHeartbeat } from './useVisibleHeartbeat'

describe('useVisibleHeartbeat', () => {
  let visibilityState: DocumentVisibilityState = 'visible'
  let cleanup: (() => void) | undefined
  const heartbeatSpy = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    heartbeatSpy.mockClear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    vi.useRealTimers()
    visibilityState = 'visible'
  })

  it('sends heartbeats only while visible and restarts when the tab becomes visible again', () => {
    cleanup = bindVisibleHeartbeat({
      heartbeat: heartbeatSpy,
      getVisibilityState: () => visibilityState,
      addWindowListener: window.addEventListener.bind(window),
      removeWindowListener: window.removeEventListener.bind(window),
      addDocumentListener: document.addEventListener.bind(document),
      removeDocumentListener: document.removeEventListener.bind(document),
      setIntervalFn: window.setInterval.bind(window),
      clearIntervalFn: window.clearInterval.bind(window),
    })

    expect(heartbeatSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)
    expect(heartbeatSpy).toHaveBeenCalledTimes(2)

    visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(20_000)
    expect(heartbeatSpy).toHaveBeenCalledTimes(2)

    visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(heartbeatSpy).toHaveBeenCalledTimes(3)

    vi.advanceTimersByTime(10_000)
    expect(heartbeatSpy).toHaveBeenCalledTimes(4)

    window.dispatchEvent(new Event('focus'))
    expect(heartbeatSpy).toHaveBeenCalledTimes(5)
  })
})
