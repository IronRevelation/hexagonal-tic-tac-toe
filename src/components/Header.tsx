import { Link, useRouterState } from '@tanstack/react-router'
import { useGuestSession } from '../lib/GuestSessionProvider'
import {
  guestChip,
  navLink,
  navLinkActive,
  pageWrap,
} from '../lib/ui'

export default function Header() {
  const { session } = useGuestSession()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname.startsWith('/games/')) {
    return null
  }

  return (
    <header className="sticky top-0 z-40 px-4 pt-4">
      <nav
        className={`${pageWrap} grid items-center gap-4 rounded-[1.6rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--header-bg)_86%,transparent_14%)] px-4 py-[0.9rem] shadow-[0_18px_36px_rgba(23,50,68,0.08)] backdrop-blur-[18px] min-[821px]:grid-cols-[auto_1fr_auto] max-[820px]:justify-items-start`}
      >
        <h2 className="m-0 flex items-center text-base font-semibold leading-none tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-3 leading-none text-[0.95rem] text-[var(--sea-ink)] no-underline transition-opacity duration-[180ms] hover:opacity-85"
          >
            <img
              alt="Hexagonal Tic-Tac-Toe logo"
              className="block h-9 w-9 shrink-0 object-contain"
              height={36}
              src="/logo192.png"
              width={36}
            />
            <span className="block">Hexagonal Tic-Tac-Toe</span>
          </Link>
        </h2>

        <div className="flex items-center justify-center gap-4 max-[820px]:justify-self-stretch">
          <Link
            to="/"
            className={navLink}
            activeProps={{ className: navLinkActive }}
          >
            Lobby
          </Link>
          <Link
            to="/about"
            className={navLink}
            activeProps={{ className: navLinkActive }}
          >
            Rules
          </Link>
        </div>

        <div className="flex items-center justify-self-end gap-[0.8rem] max-[820px]:justify-self-stretch">
          <span className={guestChip}>
            {session ? `Guest: ${session.displayName}` : 'Guest created on first game'}
          </span>
        </div>
      </nav>
    </header>
  )
}
