export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer px-4 pb-10 pt-8 text-[var(--sea-ink-soft)]">
      <div className="page-wrap footer-bar">
        <p className="m-0 text-sm">&copy; {year} Hexagonal Tic-Tac-Toe Online</p>
        <p className="island-kicker m-0">Realtime multiplayer via Convex</p>
      </div>
    </footer>
  )
}
