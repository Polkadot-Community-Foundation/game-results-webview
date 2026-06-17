// UsernameCTAScreen — post-NFT-reveal moment celebrating personhood
// (candidate → member transition).
//
// Three variants share a common shell. The variant is chosen from the
// `availability` prop, which native populates by querying People Chain
// for the base (no-suffix) member username:
//
//   - 'available' → CONFIDENT CEREMONY. The current "drop the .01" beat:
//     candidate handle appears in full, suffix lifts off, stem slides
//     right + glow flashes + sparkle burst. Only fires when we KNOW the
//     base name is free.
//
//   - 'taken' → NAME-TAKEN. Soft celebration (glow without the suffix
//     drop). Tells the user their handle is claimed and lists any
//     alternative names native passed back. Claiming happens in the
//     Prizes chat.
//
//   - undefined | 'unknown' → CAUTIOUS GENERIC. We don't know if the
//     base name is free, so we don't celebrate the claimable name.
//     Just the generic "Make it yours." title + claim-in-the-Prizes-chat
//     note. No claimable name shown, no suffix drop.
//
// All three open with "Make it yours." rather than re-greeting — the results
// screen already welcomed the new member a beat earlier (and by their display
// name, not the candidate handle), so a second "Welcome, byteboro.42." here
// was both redundant and confusing.
//
// Hard rule: the suffix-drop ceremony ONLY plays for `'available'`. If
// availability is anything else (or absent), we celebrate membership
// generically — we never fabricate a name we couldn't confirm is free.

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { sfx } from '../audio/engine'
import { haptic } from '../haptics/engine'
import { prefersReducedMotion } from '../anim/easings'
import InfoTip from '../components/InfoTip'
import { CONCEPTS } from '../copy/concepts'
import type { UsernameAvailability } from '../bridge/types'

interface UsernameCTAScreenProps {
  /** Resolved availability of the suggested base name. Drives variant. */
  availability?: UsernameAvailability
  suggestedUsername?: string
  previousUsername?: string
  /** Alternative names native passed when availability === 'taken'. */
  alternatives?: string[]
  onContinue: () => void
}

type Variant = 'available' | 'taken' | 'cautious'

// How long to wait for a late availability push before committing to the
// cautious generic variant. The bridge contract (types.ts) documents that an
// absent availability shows the cautious variant "after a short wait", and
// native may push setUsernameAvailability(...) asynchronously — App also nudges
// it via flow.username_availability_needed. Tunable.
const AVAILABILITY_GRACE_MS = 1200

/** Resolve the screen variant from availability + name. Returns null only when
 *  we HAVE a name to celebrate but availability hasn't resolved yet — the
 *  "wait a beat" case. With no name there's nothing to wait for, so we commit
 *  to cautious immediately. */
function decideVariant(a: UsernameAvailability | undefined, s: string | undefined): Variant | null {
  if (a === 'available' && s) return 'available'
  if (a === 'taken' && s) return 'taken'
  if (!s) return 'cautious'
  return null
}

export default function UsernameCTAScreen({
  availability,
  suggestedUsername,
  previousUsername,
  alternatives,
  onContinue
}: UsernameCTAScreenProps) {
  // Pick the variant, honoring the documented short wait: if we have a name to
  // celebrate but availability hasn't resolved, hold briefly for a late push
  // before falling back to cautious. Previously the variant locked at mount
  // with ZERO wait, so an 'available' arriving 100ms later was ignored and the
  // suffix-drop ceremony never played. Once committed we never switch — the
  // original intent (don't restart animations on a late change) still holds.
  const [variant, setVariant] = useState<Variant | null>(
    () => decideVariant(availability, suggestedUsername)
  )
  useEffect(() => {
    if (variant) return  // already committed — never switch
    const decided = decideVariant(availability, suggestedUsername)
    if (decided) { setVariant(decided); return }
    const t = window.setTimeout(() => setVariant('cautious'), AVAILABILITY_GRACE_MS)
    return () => window.clearTimeout(t)
  }, [variant, availability, suggestedUsername])

  return (
    <div className={`username-screen${variant ? ` username-screen-${variant}` : ''}`}>
      <div className="username-pattern-bg" aria-hidden="true" />
      {variant === 'available' && (
        <AvailableVariant
          stem={suggestedUsername!}
          previousUsername={previousUsername}
          onNext={onContinue}
        />
      )}
      {variant === 'taken' && (
        <TakenVariant
          name={suggestedUsername!}
          previousUsername={previousUsername}
          alternatives={alternatives}
          onNext={onContinue}
        />
      )}
      {variant === 'cautious' && (
        <CautiousVariant onNext={onContinue} />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// AVAILABLE — the confident ceremony. Original animation, preserved.
// ────────────────────────────────────────────────────────────────────────

/** Compute the trailing `.XX` part to animate off the candidate name.
 *  Falls back to ".01" if we can't derive a suffix. */
function deriveSuffix(stem: string, prior: string | undefined): string {
  if (prior && prior.startsWith(stem + '.')) return prior.slice(stem.length)
  if (prior && prior !== stem) {
    const i = prior.indexOf(stem)
    if (i === 0) return prior.slice(stem.length)
  }
  return '.01'
}

interface AvailableProps {
  stem: string
  previousUsername?: string
  onNext: () => void
}

function AvailableVariant({ stem, previousUsername, onNext }: AvailableProps) {
  const suffix = deriveSuffix(stem, previousUsername)
  const reduced = prefersReducedMotion()

  const titleRef = useRef<HTMLHeadingElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const stemRef = useRef<HTMLSpanElement>(null)
  const suffixRef = useRef<HTMLSpanElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const burstRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [ctaReady, setCtaReady] = useState(false)

  useEffect(() => {
    if (reduced) {
      // Reduced-motion path: snap all elements to final state with a
      // quick fade. No suffix drop, no glow yoyo, no sparkle burst,
      // no haptic finale.
      const els = [titleRef.current, hintRef.current, stemRef.current, noteRef.current, ctaRef.current].filter(Boolean)
      gsap.set(els, { opacity: 1, y: 0, scale: 1 })
      // Suffix stays visible (we're not animating it away) so the user
      // still sees the candidate handle they had.
      gsap.set(suffixRef.current, { opacity: 1, y: 0, scale: 1 })
      gsap.set(glowRef.current, { opacity: 0.65, scale: 1 })
      setCtaReady(true)
      return
    }

    const suffixWidth = suffixRef.current?.offsetWidth ?? 0
    const slideX = suffixWidth / 2

    const tl = gsap.timeline()

    tl.fromTo(titleRef.current,
      { opacity: 0, y: -16, scale: 0.92 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }
    )
    tl.fromTo(hintRef.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      '-=0.2'
    )
    tl.fromTo([stemRef.current, suffixRef.current],
      { opacity: 0, y: 22, scale: 0.85 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.4)' },
      '-=0.15'
    )
    tl.to({}, { duration: 0.7 })
    tl.add(() => {
      sfx.initFromGesture()
      haptic.initFromGesture()
      sfx.play('finale')
      haptic.play('finale')
      // Anchor the burst at the suffix's exact screen center BEFORE
      // spawning particles, so the dots emanate from where the numbers
      // are about to drop. Done at emit-time (not via static CSS)
      // because the suffix's position depends on the stem's natural
      // width — pre-computing in CSS would only be right for one
      // username length.
      if (suffixRef.current && burstRef.current && burstRef.current.parentElement) {
        const suffix = suffixRef.current.getBoundingClientRect()
        const parent = burstRef.current.parentElement.getBoundingClientRect()
        burstRef.current.style.left = `${suffix.left - parent.left + suffix.width / 2}px`
        burstRef.current.style.top = `${suffix.top - parent.top + suffix.height / 2}px`
        burstRef.current.style.transform = 'none'  // override any inherited transform
      }
      burstSparkles(burstRef.current)
    })
    tl.to(suffixRef.current, {
      y: -30, opacity: 0, scale: 0.65, duration: 0.55, ease: 'power2.in'
    })
    tl.to(stemRef.current, {
      x: slideX, duration: 0.55, ease: 'power2.inOut'
    }, '<')
    tl.to(stemRef.current, {
      scale: 1.08, duration: 0.22, ease: 'power2.out'
    }, '-=0.35')
    tl.to(stemRef.current, {
      scale: 1, duration: 0.45, ease: 'back.out(1.6)'
    })
    tl.fromTo(glowRef.current,
      { opacity: 0, scale: 0.55 },
      { opacity: 1, scale: 1, duration: 0.45, ease: 'power2.out' },
      '-=0.7'
    )
    tl.to(glowRef.current, {
      opacity: 0.65, scale: 1.04,
      duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut'
    })
    tl.fromTo(noteRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      '-=1.1'
    )
    tl.fromTo(ctaRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out',
        onComplete: () => setCtaReady(true) },
      '-=0.25'
    )
    return () => { tl.kill() }
  }, [reduced])

  return (
    <>
      <h1 className="username-title" ref={titleRef}>
        Make it yours.
      </h1>
      <div className="username-hint" ref={hintRef}>
        Time to drop the {suffix}.
      </div>
      <div className="username-display-wrap">
        <div className="username-glow" ref={glowRef} aria-hidden="true" />
        <div className="username-display">
          <span className="username-stem" ref={stemRef}>{stem}</span>
          <span className="username-suffix" ref={suffixRef}>{suffix}</span>
        </div>
        <div className="username-burst" ref={burstRef} aria-hidden="true" />
      </div>
      <div className="username-note" ref={noteRef}>
        You can claim your new username in the Prizes chat.
        {' '}<InfoTip title={CONCEPTS.username.title} body={CONCEPTS.username.body} label="What's this username?" />
      </div>
      <button
        type="button"
        className="username-cta cta-primary"
        ref={ctaRef}
        onClick={onNext}
        disabled={!ctaReady}
      >
        Next
      </button>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// TAKEN — the suggested name is claimed. Softer celebration, no drop.
// ────────────────────────────────────────────────────────────────────────

interface TakenProps {
  name: string
  previousUsername?: string
  alternatives?: string[]
  onNext: () => void
}

function TakenVariant({ name, previousUsername, alternatives, onNext }: TakenProps) {
  const reduced = prefersReducedMotion()

  const titleRef = useRef<HTMLHeadingElement>(null)
  const subheadRef = useRef<HTMLDivElement>(null)
  const altsRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [ctaReady, setCtaReady] = useState(false)

  useEffect(() => {
    if (reduced) {
      // altsRef/keepRef only mount when hasAlts/hasKeep; filter nulls so
      // gsap.set never gets a null target (it throws on null inside an array).
      const els = [titleRef.current, subheadRef.current, altsRef.current, keepRef.current, noteRef.current, ctaRef.current].filter(Boolean)
      gsap.set(els, { opacity: 1, y: 0 })
      setCtaReady(true)
      return
    }

    const tl = gsap.timeline()
    tl.fromTo(titleRef.current,
      { opacity: 0, y: -16, scale: 0.92 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }
    )
    tl.fromTo(subheadRef.current,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      '-=0.15'
    )
    if (altsRef.current) {
      tl.fromTo(altsRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
        '-=0.1'
      )
    }
    if (keepRef.current) {
      tl.fromTo(keepRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
        '-=0.15'
      )
    }
    tl.fromTo(noteRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' },
      '-=0.15'
    )
    tl.fromTo(ctaRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out',
        onComplete: () => setCtaReady(true) },
      '-=0.2'
    )
    return () => { tl.kill() }
  }, [reduced])

  const hasAlts = !!alternatives && alternatives.length > 0
  const hasKeep = !!previousUsername && previousUsername !== name

  return (
    <>
      <h1 className="username-title" ref={titleRef}>
        Make it yours.
      </h1>
      <div className="username-taken-subhead" ref={subheadRef}>
        <span className="username-taken-name">{name}</span> is already claimed.
      </div>
      {hasAlts && (
        <div className="username-taken-alts" ref={altsRef} aria-label="Suggested alternatives">
          {alternatives!.map((alt) => (
            <span key={alt} className="username-taken-alt-chip">{alt}</span>
          ))}
        </div>
      )}
      {hasKeep && (
        <div className="username-taken-keep" ref={keepRef}>
          You'll keep <strong>{previousUsername}</strong> until you pick one.
        </div>
      )}
      <div className="username-note" ref={noteRef}>
        You can claim your new username in the Prizes chat.
        {' '}<InfoTip title={CONCEPTS.username.title} body={CONCEPTS.username.body} label="What's this username?" />
      </div>
      <button
        type="button"
        className="username-cta cta-primary"
        ref={ctaRef}
        onClick={onNext}
        disabled={!ctaReady}
      >
        Next
      </button>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// CAUTIOUS — availability unknown. Generic celebration, no specific name.
// ────────────────────────────────────────────────────────────────────────

interface CautiousProps {
  onNext: () => void
}

function CautiousVariant({ onNext }: CautiousProps) {
  const reduced = prefersReducedMotion()

  const titleRef = useRef<HTMLHeadingElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [ctaReady, setCtaReady] = useState(false)

  useEffect(() => {
    if (reduced) {
      gsap.set([titleRef.current, noteRef.current, ctaRef.current],
        { opacity: 1, y: 0 })
      setCtaReady(true)
      return
    }

    const tl = gsap.timeline()
    tl.fromTo(titleRef.current,
      { opacity: 0, y: -16, scale: 0.92 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }
    )
    tl.fromTo(noteRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
      '+=0.1'
    )
    tl.fromTo(ctaRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out',
        onComplete: () => setCtaReady(true) },
      '-=0.2'
    )
    return () => { tl.kill() }
  }, [reduced])

  return (
    <>
      <h1 className="username-title" ref={titleRef}>
        Make it yours.
      </h1>
      <div className="username-note username-note-cautious" ref={noteRef}>
        You can claim your new username in the Prizes chat.
        {' '}<InfoTip title={CONCEPTS.username.title} body={CONCEPTS.username.body} label="What's this username?" />
      </div>
      <button
        type="button"
        className="username-cta cta-primary"
        ref={ctaRef}
        onClick={onNext}
        disabled={!ctaReady}
      >
        Next
      </button>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sparkle burst — used only by the AvailableVariant ceremony.
// ────────────────────────────────────────────────────────────────────────

/** Burst N small white-blue sparkle pellets from the suffix anchor.
 *  Pure DOM + GSAP — no canvas, no asset. */
function burstSparkles(container: HTMLDivElement | null): void {
  if (!container) return
  const N = 16
  for (let i = 0; i < N; i++) {
    const dot = document.createElement('span')
    dot.className = 'username-burst-dot'
    container.appendChild(dot)
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist = 56 + Math.random() * 70
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 6
    gsap.fromTo(dot,
      { x: 0, y: 0, scale: 0.4, opacity: 0 },
      {
        x: dx, y: dy,
        scale: 1, opacity: 1,
        duration: 0.20,
        ease: 'power2.out',
        onComplete: () => {
          gsap.to(dot, {
            x: dx * 1.35,
            y: dy * 1.35 + 32,
            opacity: 0,
            scale: 0.25,
            duration: 0.55,
            ease: 'power1.in',
            onComplete: () => { dot.remove() }
          })
        }
      }
    )
  }
}
