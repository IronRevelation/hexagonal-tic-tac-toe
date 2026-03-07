import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'
import { useGuestSession } from '../lib/GuestSessionProvider'

export default function Header() {
  const { session } = useGuestSession()

  return (
    <header className="site-header px-4">
      <nav className="page-wrap header-bar">
        <h2 className="m-0 text-base font-semibold tracking-tight">
          <Link to="/" className="brand-pill">
            <span className="brand-orb" />
            Hexagonal Tic-Tac-Toe
          </Link>
        </h2>

        <div className="header-links">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Lobby
          </Link>
          <Link
            to="/about"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Rules
          </Link>
        </div>

        <div className="header-status">
          <span className="guest-chip">
            {session ? `Guest: ${session.displayName}` : 'Creating guest…'}
          </span>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
