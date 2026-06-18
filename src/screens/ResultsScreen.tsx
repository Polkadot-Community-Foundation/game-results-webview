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
import InfoTip from '../components/InfoTip'
import { haptic } from '../haptics/engine'
import { prefersReducedMotion } from '../anim/easings'
import { CONCEPTS } from '../copy/concepts'
import type { GameOutcome } from '../bridge/types'

/** Resting opacity of the dimmed burst backdrop on the "Nice haul!" variant —
 *  well below the celebration's 0.6 so it reads as a muted echo. */
const HAUL_BG_OPACITY = 0.32

interface ResultsScreenProps {
  outcome: GameOutcome
  /** The user's display name for the membership card (outcome-independent,
   *  so it comes from setGameResults, not the outcome). */
  displayName?: string
  /** How many collectibles the player earned this game (on-shelf count from
   *  the reveal). Drives the "you collected N" congratulation. */
  collectedCount: number
  onContinue: () => void
}

export default function ResultsScreen({ outcome, displayName, collectedCount, onContinue }: ResultsScreenProps) {
  const isCelebration = outcome.justBecameMember
  // "Nice haul!" variant: failed the game but still earned collectibles. Gets
  // a dimmed, desaturated take on the membership burst as a backdrop plus a
  // forward nudge toward membership.
  const isHaul = !outcome.passed && collectedCount > 0
  // Failure copy is uniform — the results screen no longer surfaces
  // rank/progression, so it doesn't distinguish how the player failed.
  const reduced = prefersReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const celebrationHeadlineRef = useRef<HTMLHeadingElement>(null)
  const celebrationBgRef = useRef<HTMLImageElement>(null)
  const haulBgRef = useRef<HTMLImageElement>(null)
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
      if (haulBgRef.current) {
        gsap.set(haulBgRef.current, { opacity: HAUL_BG_OPACITY, xPercent: -50, yPercent: -50 })
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

    // Haul variant: the dimmed burst fades up gently behind the summary —
    // a softer echo of the celebration, no scale punch or sparkle.
    if (isHaul && haulBgRef.current) {
      tl.fromTo(haulBgRef.current,
        { opacity: 0, scale: 0.9, xPercent: -50, yPercent: -50 },
        { opacity: HAUL_BG_OPACITY, scale: 1, duration: 0.85, ease: 'power2.out' },
        0.1
      )
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
  }, [isCelebration, isHaul, reduced])

  // Outcome copy. Leads with the collectibles haul (count + congrats), then:
  //   - for players heading into the prize draw, INTRODUCES it (so the draw
  //     isn't a surprise), and
  //   - for failed players, a forward nudge — NEVER a "you lost" framing.
  //     "Not this time" / loss language is reserved for the prize-draw result
  //     (ResultHero "no win this time"), which only people who actually saw
  //     the draw reach.
  const passed = outcome.passed
  const goingToDraw = passed && outcome.prizeDraw !== null
  const haul = collectedCount === 1 ? '1 collectible' : `${collectedCount} collectibles`

  let summaryHeadline: string
  let summarySub: string
  if (passed) {
    // Greet new members by display name (NOT previousUsername, the old
    // candidate handle they're leaving behind).
    summaryHeadline = outcome.justBecameMember
      ? `Welcome, ${displayName ?? 'member'}.`
      : `Nice run.`
    summarySub = goingToDraw
      ? `You collected ${haul}, and you've earned a spot in the prize draw.`
      : `You collected ${haul}.`
  } else if (collectedCount > 0) {
    // Failed the game but earned collectibles — celebrate the haul, no loss
    // framing. Membership-agnostic: this branch covers both candidates and
    // existing members who didn't pass, and the outcome doesn't expose which.
    summaryHeadline = `Nice haul!`
    summarySub = `You collected ${haul}.`
  } else {
    // Failed with nothing this round — still no "you lost", just a nudge.
    summaryHeadline = `Next time!`
    summarySub = `Play and pass games to earn collectibles for your Pocket.`
  }

  return (
    <div
      className={`results-screen ${isCelebration ? 'is-celebration' : ''}`}
      ref={rootRef}
    >
      {/* Decorative burst backdrops live OUTSIDE the scroll layer so their
          deliberate over-size never creates phantom scroll. */}
      {isCelebration && (
        <img
          className="results-celebration-bg"
          ref={celebrationBgRef}
          src="./assets/burst-rainbow.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      {/* Dimmed, desaturated echo of the membership burst — the same asset as
          the celebration, muted via CSS filter + low opacity (see
          .results-haul-bg). Sits behind the (cardless) haul summary. */}
      {isHaul && (
        <img
          className="results-haul-bg"
          ref={haulBgRef}
          src="./assets/burst-rainbow.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}

      <div className="results-scroll">
        {isCelebration && (
          <h1
            className="results-celebration-headline"
            ref={celebrationHeadlineRef}
          >
            Membership<br />unlocked.
          </h1>
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
          <div className="results-summary-sub">
            {summarySub}
            {outcome.justBecameMember && (
              <>{' '}<InfoTip title={CONCEPTS.membership.title} body={CONCEPTS.membership.body} label="What is membership?" /></>
            )}
          </div>
          {/* Forward nudge on the haul screen — points toward the membership
              payoff. (Also surfaces to the rare existing-member-who-failed
              case; the outcome contract can't currently distinguish them.) */}
          {isHaul && (
            <div className="results-haul-nudge">Keep playing to get your membership!</div>
          )}
        </div>

        <button
          type="button"
          className="results-continue cta-primary"
          ref={ctaRef}
          onClick={onContinue}
          disabled={!ctaReady}
          data-ready={ctaReady ? 'true' : 'false'}
        >
          Continue
        </button>
      </div>
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
