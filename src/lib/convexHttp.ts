import { ConvexHttpClient } from 'convex/browser'

let client: ConvexHttpClient | null = null

export function getConvexHttpClient() {
  const url = import.meta.env.VITE_CONVEX_URL

  if (!url) {
    throw new Error('Missing VITE_CONVEX_URL.')
  }

  if (!client || client.url !== url) {
    client = new ConvexHttpClient(url)
  }

  return client
}
