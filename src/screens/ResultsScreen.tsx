// ResultsScreen — entry into the post-game flow.
//
// Two visual variants share a single component:
//   - Standard:  small "YOUR RESULTS" eyebrow + card + summary + Continue.
//   - Celebration (justBecameMember === true): big "Membership unlocked."
//     headline, burst-rainbow backdrop (FLAGGED asset), DOM sparkle
//     burst around the card on entrance, haptic ka-bang. This is the
//     moment of arrival for first-time members — should feel earned.
//
// Asset usage (FLAGGED for swap):
//   - `./assets/burst-rainbow.webp` — reused from the legendary NFT
//     reveal. Low-opacity, blurred, sits behind the card on celebration.
//     Already part of the app's celebration vocabulary; swap to a
//     bespoke "membership burst" later if desired.
//   - DOM sparkle pellets for the burst — no asset; same pattern as
//     UsernameCTAScreen's `.username-burst-dot`.
//
// User-facing copy never mentions "attestations" — the user just sees
// their collectible count + outcome framing.

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import MemberCard from '../components/MemberCard'
import { haptic } from '../haptics/engine'
import { prefersReducedMotion } from '../anim/easings'
import type { GameOutcome } from '../bridge/types'

interface ResultsScreenProps {
  outcome: GameOutcome
  /** The user's display name for the membership card (outcome-independent,
   *  so it comes from setGameResults, not the outcome). */
  displayName?: string
  onContinue: () => void
}

export default function ResultsScreen({ outcome, displayName, onContinue }: ResultsScreenProps) {
  const isCelebration = outcome.justBecameMember
  // Failure copy is uniform — the results screen no longer surfaces
  // rank/progression, so it doesn't distinguish how the player failed.
  const reduced = prefersReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const celebrationHeadlineRef = useRef<HTMLHeadingElement>(null)
  const celebrationBgRef = useRef<HTMLImageElement>(null)
  const burstRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [ctaReady, setCtaReady] = useState(false)

  useEffect(() => {
    if (reduced) {
      // Reduced-motion path: snap all elements to final state.
      // celebrationBg/Headline only mount when isCelebration; filter nulls so
      // gsap.set never gets a null target (it throws on null inside an array).
      const els = [celebrationBgRef.current, celebrationHeadlineRef.current,
                   summaryRef.current, ctaRef.current].filter(Boolean)
      gsap.set(els, { opacity: 1, y: 0, scale: 1 })
      if (celebrationBgRef.current) {
        gsap.set(celebrationBgRef.current, { opacity: 0.6, xPercent: -50, yPercent: -50 })
      }
      setCtaReady(true)
      return
    }

    const tl = gsap.timeline()

    // Celebration variant: backdrop fades in well behind everything,
    // headline punches in, sparkles burst from card center at ~1.0s
    // (right as the card finishes settling), haptic lands with it.
    if (isCelebration) {
      if (celebrationBgRef.current) {
        // GSAP owns the burst's transform — including xPercent/yPercent
        // for the centering translate — so its scale entrance can't
        // clobber the CSS translate (which is what was leaving the
        // burst stuck in the bottom-right earlier). With xPercent: -50
        // / yPercent: -50 alongside CSS `left: 50%; top: 50%`, the
        // image's bbox center (~50%, 50%) lands at the viewport center.
        tl.fromTo(celebrationBgRef.current,
          { opacity: 0, scale: 0.85, xPercent: -50, yPercent: -50 },
          { opacity: 0.6, scale: 1, duration: 0.9, ease: 'power2.out' },
          0
        )
      }
      if (celebrationHeadlineRef.current) {
        tl.fromTo(celebrationHeadlineRef.current,
          { opacity: 0, y: -18, scale: 0.92 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.6)' },
          0.15
        )
      }
      // Burst + haptic on card-landing moment.
      tl.add(() => {
        haptic.initFromGesture()
        haptic.play('finale')
        burstSparkles(burstRef.current)
      }, 1.05)
    }

    if (summaryRef.current) {
      tl.fromTo(summaryRef.current,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
        isCelebration ? 1.3 : 1.0
      )
    }
    if (ctaRef.current) {
      tl.fromTo(ctaRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', onComplete: () => setCtaReady(true) },
        '+=0.25'
      )
    }
    return () => { tl.kill() }
  }, [isCelebration, reduced])

  // Outcome copy — never exposes counts. Teases what's next so the
  // user knows there's more to come (prize draw, collectibles, etc.).
  const passed = outcome.passed
  const hasPrizeDraw = outcome.prizeDraw !== null

  let summaryHeadline: string
  let summarySub: string
  if (passed) {
    if (outcome.justBecameMember) {
      // Greet with the user's display name — NOT previousUsername, which is
      // the old auto-assigned candidate handle (e.g. "byteboro.42") they're
      // leaving behind; greeting a brand-new member by it reads wrong.
      summaryHeadline = `Welcome, ${displayName ?? 'member'}.`
      summarySub = hasPrizeDraw
        ? `Your first member prize draw is up next.`
        : `Membership unlocked.`
    } else {
      summaryHeadline = `Nice run.`
      summarySub = hasPrizeDraw
        ? `Your prize draw is up next.`
        : `See you next round.`
    }
  } else {
    // Failed — uniform copy. The reveal already showed whatever collectibles
    // they earned; the verdict doesn't distinguish how they fell short.
    summaryHeadline = `Not your week.`
    summarySub = `Better luck next round.`
  }

  return (
    <div
      className={`results-screen ${isCelebration ? 'is-celebration' : ''}`}
      ref={rootRef}
    >
      {isCelebration && (
        <>
          <img
            className="results-celebration-bg"
            ref={celebrationBgRef}
            src="./assets/burst-rainbow.webp"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <h1
            className="results-celebration-headline"
            ref={celebrationHeadlineRef}
          >
            Membership<br />unlocked.
          </h1>
        </>
      )}

      {!isCelebration && (
        <header className="results-eyebrow">YOUR RESULTS</header>
      )}

      <div className="results-card-wrap">
        {/* Membership card only for passers — a failed player isn't a
            member, so the verdict for them is copy-only. */}
        {passed && (
          <MemberCard
            {...(displayName ? { displayName } : {})}
            promoted={outcome.justBecameMember}
          />
        )}
        {isCelebration && (
          <div
            className="results-celebration-burst"
            ref={burstRef}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="results-summary" ref={summaryRef}>
        <div className="results-summary-headline">{summaryHeadline}</div>
        <div className="results-summary-sub">{summarySub}</div>
      </div>

      <button
        type="button"
        className="results-continue"
        ref={ctaRef}
        onClick={onContinue}
        disabled={!ctaReady}
        data-ready={ctaReady ? 'true' : 'false'}
      >
        Continue
      </button>
    </div>
  )
}

/** Same DOM-sparkle pattern as UsernameCTAScreen — 18 pellets emit
 *  from the card's center, fly outward with a gravity-ish drop, then
 *  fade and remove themselves. Slightly more pellets than the username
 *  burst since this is the bigger "moment". */
function burstSparkles(container: HTMLDivElement | null): void {
  if (!container) return
  const N = 22
  for (let i = 0; i < N; i++) {
    const dot = document.createElement('span')
    dot.className = 'results-celebration-burst-dot'
    container.appendChild(dot)
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist = 90 + Math.random() * 80
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 8
    gsap.fromTo(dot,
      { x: 0, y: 0, scale: 0.4, opacity: 0 },
      {
        x: dx, y: dy,
        scale: 1, opacity: 1,
        duration: 0.22,
        ease: 'power2.out',
        onComplete: () => {
          gsap.to(dot, {
            x: dx * 1.4,
            y: dy * 1.4 + 50,
            opacity: 0,
            scale: 0.25,
            duration: 0.7,
            ease: 'power1.in',
            onComplete: () => { dot.remove() }
          })
        }
      }
    )
  }
}
