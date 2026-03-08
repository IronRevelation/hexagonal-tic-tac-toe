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
    <footer className="mt-12 px-4 pb-10 pt-8 text-[var(--sea-ink-soft)]">
      <div className={`${pageWrap} border-t border-[var(--line)] py-5`}>
        <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between md:gap-6">
          <p className="m-0 font-medium text-[var(--sea-ink)]">
            &copy; {year} Hexagonal Tic-Tac-Toe Online
          </p>
          <p className="m-0 flex flex-wrap items-center gap-3 md:text-center">
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
          <p className="m-0 text-[color:color-mix(in_oklab,var(--sea-ink-soft)_82%,transparent)] md:text-right">
            Independent fan project, not affiliated with webgoatguy.
          </p>
        </div>
      </div>
    </footer>
  )
}
