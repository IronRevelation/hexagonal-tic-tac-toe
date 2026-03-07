type ErrorPayload = {
  code?: string
  message?: string
}

export function getConvexErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null
  ) {
    const payload = error.data as ErrorPayload
    if (payload.message) {
      return payload.message
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
