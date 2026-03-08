import { Link, useRouterState } from '@tanstack/react-router'
import { CONTACT_EMAIL } from '../../shared/legal'
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
    <footer className="mt-10 px-4 pb-8 pt-6 text-[var(--sea-ink-soft)] max-[720px]:mt-8">
      <div className={`${pageWrap} border-t border-[var(--line)] py-5`}>
        <div className="flex flex-col gap-3 text-sm max-[720px]:text-[0.95rem] md:flex-row md:items-center md:justify-between md:gap-6">
          <p className="m-0 font-medium text-[var(--sea-ink)]">
            &copy; {year} Hexagonal Tic-Tac-Toe Online
          </p>
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 md:text-center">
            <Link className="font-semibold text-[var(--sea-ink)] no-underline" to="/privacy">
              Privacy
            </Link>
            <Link className="font-semibold text-[var(--sea-ink)] no-underline" to="/terms">
              Terms
            </Link>
            <a
              className="font-semibold text-[var(--sea-ink)] no-underline"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="m-0 md:text-center">
            Game invented by{' '}
            <a
              className="font-semibold"
              href="https://www.youtube.com/@webgoatguy/"
              rel="noreferrer"
              target="_blank"
            >
              webgoatguy
            </a>
          </p>
          <p className="m-0 max-w-[32rem] text-[color:color-mix(in_oklab,var(--sea-ink-soft)_82%,transparent)] md:text-right">
            Independent fan project, not affiliated with webgoatguy.
          </p>
        </div>
      </div>
    </footer>
  )
}
