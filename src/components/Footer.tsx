import { useRouterState } from '@tanstack/react-router'
import { pageWrap } from '../lib/ui'

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
      <div className={`${pageWrap} border-t border-[var(--line)] py-4`}>
        <p className="m-0 text-sm">&copy; {year} Hexagonal Tic-Tac-Toe Online</p>
      </div>
    </footer>
  )
}
