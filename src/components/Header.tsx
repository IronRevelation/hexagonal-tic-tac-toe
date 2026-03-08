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
    <header className="z-40 px-4 pt-3 min-[721px]:sticky min-[721px]:top-0 min-[721px]:pt-4">
      <nav
        className={`${pageWrap} grid items-center gap-3 rounded-[1.6rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--header-bg)_88%,transparent_12%)] px-4 py-4 shadow-[0_18px_36px_rgba(23,50,68,0.08)] backdrop-blur-[18px] min-[821px]:grid-cols-[auto_1fr_auto] max-[820px]:justify-items-start max-[720px]:gap-4 max-[720px]:rounded-[1.4rem] max-[720px]:px-4 max-[720px]:py-4`}
      >
        <h2 className="m-0 flex items-center text-base font-semibold leading-none tracking-tight max-[720px]:w-full">
          <Link
            to="/"
            className="inline-flex items-center gap-3 leading-none text-[0.95rem] text-[var(--sea-ink)] no-underline transition-opacity duration-[180ms] hover:opacity-85 max-[720px]:w-full max-[720px]:gap-2.5 max-[720px]:text-[0.92rem]"
          >
            <img
              alt="Hexagonal Tic-Tac-Toe logo"
              className="block h-9 w-9 shrink-0 rounded-[0.7rem] object-contain max-[720px]:h-10 max-[720px]:w-10"
              height={36}
              src="/logo192.png"
              width={36}
            />
            <span className="block max-[420px]:max-w-[11rem]">Hexagonal Tic-Tac-Toe</span>
          </Link>
        </h2>

        <div className="flex items-center justify-center gap-4 max-[820px]:justify-self-stretch max-[720px]:w-full max-[720px]:justify-start">
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

        <div className="flex items-center justify-self-end gap-[0.8rem] max-[820px]:justify-self-stretch max-[720px]:hidden">
          <span className={guestChip}>
            {session ? `Guest: ${session.displayName}` : 'Guest created on first game'}
          </span>
        </div>
      </nav>
    </header>
  )
}
