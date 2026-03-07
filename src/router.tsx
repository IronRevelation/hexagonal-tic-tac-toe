import { ConvexQueryClient } from '@convex-dev/react-query'
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { ConvexProvider } from 'convex/react'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL

  if (!convexUrl) {
    throw new Error(
      'Missing VITE_CONVEX_URL. Run `npx convex dev` to generate .env.local.',
    )
  }

  const convexQueryClient = new ConvexQueryClient(convexUrl)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })

  convexQueryClient.connect(queryClient)

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      context: { queryClient },
      scrollRestoration: true,
      defaultPreload: 'intent',
      defaultPreloadStaleTime: 0,
      Wrap: ({ children }) => (
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      ),
    }),
    queryClient,
  )

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
