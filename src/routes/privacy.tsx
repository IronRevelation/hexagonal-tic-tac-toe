import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { api } from '../../convex/_generated/api'
import { CONTACT_EMAIL } from '../../shared/legal'
import { useGuestSession } from '../lib/GuestSessionProvider'
import {
  dangerButton,
  displayTitle,
  eyebrow,
  infoCard,
  mutedCopy,
  pageWrap,
  primaryButton,
  secondaryButton,
  surfacePanel,
} from '../lib/ui'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

function PrivacyPage() {
  const navigate = useNavigate()
  const { guestToken, clearGuestSession } = useGuestSession()
  const privacyInfo = useQuery(api.privacy.getPrivacyInfo, {})
  const exportData = useQuery(
    api.privacy.exportMyData,
    guestToken ? { guestToken } : 'skip',
  )
  const eraseMyData = useMutation(api.privacy.eraseMyData)
  const [status, setStatus] = useState<string | null>(null)
  const [isErasing, setIsErasing] = useState(false)

  async function handleDownloadExport() {
    if (!exportData) {
      return
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'hexagonal-tic-tac-toe-export.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus('Downloaded your data export.')
  }

  async function handleEraseMyData() {
    if (!guestToken || isErasing) {
      return
    }

    const confirmed = window.confirm(
      'Erase your guest profile? Active games will be forfeited and finished shared games will remain only in anonymized form.',
    )
    if (!confirmed) {
      return
    }

    setIsErasing(true)
    setStatus(null)

    try {
      await eraseMyData({ guestToken })
      clearGuestSession()
      setStatus('Your guest profile has been erased from this device.')
      await navigate({ to: '/' })
    } finally {
      setIsErasing(false)
    }
  }

  if (!privacyInfo) {
    return (
      <main className={`${pageWrap} px-4 py-8 max-[720px]:px-2 max-[720px]:py-5`}>
        <section className={`${surfacePanel} rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
          <p className={`${eyebrow} mb-2`}>Privacy</p>
          <h1 className={`${displayTitle} m-0 text-4xl text-[var(--sea-ink)] max-[720px]:text-[2.2rem] sm:text-5xl`}>
            Loading privacy notice…
          </h1>
        </section>
      </main>
    )
  }

  return (
    <main className={`${pageWrap} grid gap-5 px-4 py-8 max-[720px]:px-2 max-[720px]:py-5`}>
      <section className={`${surfacePanel} grid gap-4 rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
        <p className={`${eyebrow} m-0`}>Privacy</p>
        <h1 className={`${displayTitle} m-0 text-4xl text-[var(--sea-ink)] max-[720px]:text-[2.2rem] sm:text-5xl`}>
          Anonymous play still uses personal data.
        </h1>
        <p className="m-0 max-w-[50rem] leading-[1.8] text-[var(--sea-ink-soft)]">
          {privacyInfo.siteName} is controlled by {privacyInfo.controllerName}. Contact{' '}
          <a className="font-semibold text-[var(--sea-ink)]" href={`mailto:${CONTACT_EMAIL}`}>
            {privacyInfo.contactEmail}
          </a>{' '}
          for privacy requests. Controller location: {privacyInfo.controllerLocation}.
          This notice applies to users aged {privacyInfo.minimumAge}+ and is
          effective from {privacyInfo.effectiveDate}.
        </p>
      </section>

      <section className={`${surfacePanel} grid gap-6 rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">What we process</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.dataCategories.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Why we process it</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.purposes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Legal bases</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.legalBases.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`${surfacePanel} grid gap-6 rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Processors</h2>
          <ul className="m-0 grid gap-3 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.processors.map((processor) => (
              <li key={processor.name}>
                <strong className="text-[var(--sea-ink)]">{processor.name}</strong>: {processor.purpose} ({processor.location})
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">International transfers</h2>
          <ul className="m-0 grid gap-3 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.internationalTransfers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Retention</h2>
          <ul className="m-0 grid gap-3 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.retention.map((rule) => (
              <li key={rule.key}>
                <strong className="text-[var(--sea-ink)]">{rule.label}</strong>: {rule.duration}. {rule.details}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Your rights</h2>
          <ul className="m-0 grid gap-2 pl-5 text-[var(--sea-ink-soft)]">
            {privacyInfo.rights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={`${mutedCopy} m-0`}>{privacyInfo.complaintText}</p>
        </div>
      </section>

      <section className={`${surfacePanel} grid gap-4 rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
        <p className={`${eyebrow} m-0`}>Privacy tools</p>
        <h2 className="m-0 text-2xl text-[var(--sea-ink)]">Export or erase your guest data</h2>
        <p className={`${mutedCopy} m-0`}>
          These tools work for the anonymous guest currently stored on this device.
        </p>

        {!guestToken ? (
          <div className={infoCard}>
            No guest profile exists on this device yet. Start a game first if you want an
            export or erasure action to apply.
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            className={primaryButton}
            disabled={!exportData}
            onClick={() => void handleDownloadExport()}
            type="button"
          >
            Download my data
          </button>
          <button
            className={dangerButton}
            disabled={!guestToken || isErasing}
            onClick={() => void handleEraseMyData()}
            type="button"
          >
            {isErasing ? 'Erasing…' : 'Erase my guest data'}
          </button>
          <a className={secondaryButton} href={`mailto:${CONTACT_EMAIL}`}>
            Email privacy request
          </a>
        </div>

        {status ? <div className={infoCard}>{status}</div> : null}
      </section>
    </main>
  )
}
