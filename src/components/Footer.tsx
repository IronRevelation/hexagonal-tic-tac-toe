import { useRouterState } from '@tanstack/react-router'
import { eyebrow, pageWrap } from '../lib/ui'

export default function Footer() {
  const year = new Date().getFullYear()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname.startsWith('/games/')) {
    return null
  }

  return (
    <footer className="mt-12 px-4 pb-10 pt-8 text-[var(--sea-ink-soft)]">
      <div
        className={`${pageWrap} flex items-center justify-between gap-4 border-t border-[var(--line)] py-4 max-[720px]:flex-col max-[720px]:items-start`}
      >
        <p className="m-0 text-sm">&copy; {year} Hexagonal Tic-Tac-Toe Online</p>
        <p className={`${eyebrow} m-0`}>Realtime multiplayer via Convex</p>
      </div>
    </footer>
  )
}
