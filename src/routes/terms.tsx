import { createFileRoute } from '@tanstack/react-router'
import { CONTACT_EMAIL, MINIMUM_AGE } from '../../shared/legal'
import { displayTitle, eyebrow, pageWrap, surfacePanel } from '../lib/ui'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
})

function TermsPage() {
  return (
    <main className={`${pageWrap} px-4 py-12`}>
      <section className={`${surfacePanel} grid gap-6 rounded-[2rem] p-6 sm:p-8`}>
        <div className="grid gap-3">
          <p className={`${eyebrow} m-0`}>Terms</p>
          <h1 className={`${displayTitle} m-0 text-4xl text-[var(--sea-ink)] sm:text-5xl`}>
            Play fairly and use the service responsibly.
          </h1>
          <p className="m-0 max-w-[50rem] leading-[1.8] text-[var(--sea-ink-soft)]">
            By using Hexagonal Tic-Tac-Toe Online, you agree to these basic terms. The
            service is intended for users aged {MINIMUM_AGE}+.
          </p>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Acceptable use</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            <li>Use the app only for lawful play, spectating, and sharing private room links.</li>
            <li>Do not abuse matchmaking, automate gameplay, or interfere with other players.</li>
            <li>Do not attempt to scrape, overload, or disrupt the service infrastructure.</li>
            <li>Do not impersonate others or use the service to harass, threaten, or defraud anyone.</li>
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Service rules</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            <li>Guest identities are anonymous and tied to the current device unless erased.</li>
            <li>Private room links should only be shared with people you intend to invite.</li>
            <li>Disconnected active players may forfeit automatically after the in-app timeout.</li>
            <li>The service is provided on an as-is basis and may change or be removed at any time.</li>
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Contact</h2>
          <p className="m-0 leading-[1.8] text-[var(--sea-ink-soft)]">
            For support, abuse reports, or legal notices, contact{' '}
            <a className="font-semibold text-[var(--sea-ink)]" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  )
}
