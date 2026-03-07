export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export const pageWrap =
  'mx-auto w-[min(1180px,calc(100%-2rem))] max-[720px]:w-[min(100%,calc(100%-1rem))]'

export const surfacePanel =
  'border border-[var(--line)] bg-[linear-gradient(165deg,var(--surface-strong),var(--surface))] shadow-[inset_0_1px_0_var(--inset-glint),0_22px_44px_rgba(23,50,68,0.1),0_6px_18px_rgba(23,50,68,0.08)] backdrop-blur-[4px] transition-[background-color,color,border-color,transform] duration-[180ms]'

export const displayTitle = 'font-["Fraunces",Georgia,serif] leading-[0.96] tracking-[-0.04em]'

export const eyebrow = 'text-[0.69rem] font-bold uppercase tracking-[0.16em] text-[var(--kicker)]'

export const brandOrb =
  'h-[0.7rem] w-[0.7rem] rounded-full bg-[linear-gradient(135deg,var(--amber),var(--lagoon))] shadow-[0_0_0_6px_rgba(78,174,196,0.12)]'

export const brandPill =
  'inline-flex items-center gap-[0.7rem] rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 py-[0.65rem] text-[0.95rem] text-[var(--sea-ink)] no-underline shadow-[0_10px_26px_rgba(23,50,68,0.08)] transition-[background-color,color,border-color,transform] duration-[180ms]'

export const navLink =
  'relative inline-flex items-center text-[var(--sea-ink-soft)] no-underline transition-[background-color,color,border-color,transform] duration-[180ms] after:absolute after:bottom-[-6px] after:left-0 after:h-[2px] after:w-full after:origin-left after:scale-x-0 after:bg-[linear-gradient(90deg,var(--lagoon),#7ed3bf)] after:transition-transform after:duration-[170ms] hover:text-[var(--sea-ink)] hover:after:scale-x-100'

export const navLinkActive = `${navLink} text-[var(--sea-ink)] after:scale-x-100`

export const guestChip =
  'inline-flex min-h-[2.6rem] items-center gap-[0.45rem] rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-[0.9rem] py-[0.55rem] text-[0.88rem] font-bold text-[var(--sea-ink)] transition-[background-color,color,border-color,transform] duration-[180ms]'

const buttonBase =
  'inline-flex min-h-[2.8rem] cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 [font:inherit] no-underline transition-[background-color,color,border-color,transform] duration-[180ms] disabled:cursor-not-allowed disabled:opacity-[0.56]'

export const primaryButton = `${buttonBase} border-transparent bg-[linear-gradient(135deg,var(--amber),color-mix(in_oklab,var(--amber)_70%,white))] text-[#0f1820] shadow-[0_14px_28px_rgba(217,135,29,0.22)]`

export const secondaryButton = `${buttonBase} border-[var(--chip-line)] bg-[color-mix(in_oklab,var(--chip-bg)_88%,white_12%)] text-[var(--sea-ink)]`

export const dangerButton = `${buttonBase} border-transparent bg-[linear-gradient(135deg,#e57c61,#f0a37d)] text-[#24120d] shadow-[0_14px_28px_rgba(170,79,45,0.24)]`

export const fieldLabel =
  'text-[0.82rem] font-bold uppercase tracking-[0.08em] text-[var(--sea-ink-soft)]'

export const textInput =
  'min-h-12 w-full rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-strong)_86%,white_14%)] px-4 py-[0.8rem] text-[var(--sea-ink)] uppercase tracking-[0.12em] outline-none [font:inherit] placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon)]'

export const infoCard =
  'flex min-h-12 items-center gap-[0.6rem] rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--surface)_86%,white_14%)] px-[0.95rem] py-[0.8rem] text-[var(--sea-ink)]'

export const mutedCopy = 'text-[0.92rem] text-[var(--sea-ink-soft)]'

export const errorPanel =
  'mt-4 rounded-[1.4rem] border border-[rgba(154,61,35,0.22)] bg-[rgba(255,234,229,0.88)] px-[1.2rem] py-4 text-[#7a2316]'

export const modalOverlay =
  'fixed inset-0 z-[60] grid place-items-center bg-[rgba(4,12,18,0.46)] p-6 backdrop-blur-[8px]'

export const modalPanel = cn(
  surfacePanel,
  'grid w-[min(100%,25rem)] gap-[0.9rem] rounded-[1.4rem] p-5 text-center',
)

export const modalKicker =
  'm-0 text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]'
