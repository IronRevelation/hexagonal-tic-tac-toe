import { createFileRoute } from '@tanstack/react-router'
import { displayTitle, eyebrow, pageWrap, surfacePanel } from '../lib/ui'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className={`${pageWrap} px-4 py-8 max-[720px]:px-2 max-[720px]:py-5`}>
      <section className={`${surfacePanel} rounded-[2rem] p-6 max-[720px]:rounded-[1.7rem] max-[720px]:p-5 sm:p-8`}>
        <p className={`${eyebrow} mb-2`}>Rules</p>
        <h1
          className={`${displayTitle} mb-4 text-4xl font-bold text-[var(--sea-ink)] max-[720px]:text-[2.2rem] sm:text-5xl`}
        >
          Infinite hexes, six in a line, asymmetric opening.
        </h1>
        <ol className="mt-4 grid gap-[0.8rem] pl-[1.2rem] leading-[1.7] text-[var(--sea-ink-soft)]">
          <li>Player 1 opens the game with a single move on any empty hex.</li>
          <li>Player 2 answers with two consecutive moves.</li>
          <li>Every following turn also contains two moves.</li>
          <li>The board is infinite, so play can expand in any direction.</li>
          <li>The first player to connect six hexagons on one axis wins.</li>
        </ol>
      </section>
    </main>
  )
}
