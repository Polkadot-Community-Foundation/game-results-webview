// Sealed stage — the pre-reveal moment. The user sees their ticket with
// its friendly display code stamped on it, plus the framing copy
// ("20 winners") and the REVEAL button.
//
// The ticket has a subtle tremble idle so it reads as "alive". On tap
// REVEAL, a quick seal-break light-sweep fires, then onReveal() runs —
// the parent (PrizeDrawScreen) starts the reveal stage with the same
// ticket element animating continuously into the lane scene's opening
// close-up (see Phase H for the continuous transition wiring).

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'
import { formatTicketLong } from './ticketDisplay'
import type { DrawAssets } from './assets'
import InfoTip from '../components/InfoTip'
import { CONCEPTS } from '../copy/concepts'

interface SealedStageProps {
  /** The user's ticket hash — used to render the friendly code stamp. */
  userTicket: string
  /** Winning count for framing copy ("N winners"). Native sends the
   *  array; we use its length. */
  winnerCount: number
  /** Processed ticket assets (chroma-keyed + cropped). */
  assets: DrawAssets
  /** Fires when the user taps REVEAL. Parent starts the reveal stage. */
  onReveal: () => void
}

export default function SealedStage({
  userTicket,
  winnerCount,
  assets,
  onReveal
}: SealedStageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const ticketRef = useRef<HTMLDivElement>(null)
  const sealRef = useRef<HTMLDivElement>(null)
  const [ctaReady, setCtaReady] = useState(false)
  const reduced = prefersReducedMotion()

  // Entrance + tremble idle.
  useEffect(() => {
    const root = rootRef.current
    const ticket = ticketRef.current
    if (!root || !ticket) return

    if (reduced) {
      gsap.set(root, { opacity: 1, y: 0 })
      gsap.set(ticket, { opacity: 1, scale: 1, rotation: -1.4 })
      setCtaReady(true)
      return
    }

    const tl = gsap.timeline()
    tl.fromTo(root,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out' }
    )
    tl.fromTo(ticket,
      { opacity: 0, scale: 0.85, rotation: -8 },
      { opacity: 1, scale: 1, rotation: -1.4, duration: 0.7, ease: 'back.out(1.4)' },
      '-=0.35'
    )
    tl.add(() => setCtaReady(true))

    // Tremble idle — gentle rotation oscillation, infinite. Suggests
    // "alive" without competing for attention.
    const idle = gsap.to(ticket, {
      rotation: -1.0,
      duration: 2.2,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: 1.0
    })

    return () => { tl.kill(); idle.kill() }
  }, [reduced])

  function handleReveal(): void {
    if (!ctaReady) return
    if (reduced) { onReveal(); return }

    // Brief seal-break light-sweep across the ticket. The band is a CSS
    // gradient masked to the ticket silhouette; sweeping its
    // background-position (rather than transforming the element) keeps the
    // mask pixel-aligned with the ticket art behind it.
    const seal = sealRef.current
    if (seal) {
      gsap.fromTo(seal,
        { opacity: 1, backgroundPosition: '160% 0%' },
        {
          opacity: 1, backgroundPosition: '-60% 0%',
          duration: 0.45, ease: 'power2.in',
          onComplete: () => { gsap.set(seal, { opacity: 0 }) }
        }
      )
    }

    // Ticket "zooms into" the lane scene — concurrent scale-up + fade.
    // This carries the same physical-object continuity the win-lift
    // uses: the sealed ticket appears to recede into the lane world
    // rather than the page hard-cutting between scenes.
    const ticket = ticketRef.current
    if (ticket) {
      gsap.to(ticket,
        {
          scale: 1.25,
          opacity: 0,
          duration: 0.45,
          ease: 'power2.in',
          delay: 0.1
        }
      )
    }
    // Fade the rest of the sealed stage so it doesn't dominate during
    // the lane scene's first frame. Header + sub-copy + CTA fade in
    // parallel with the ticket zoom.
    const root = rootRef.current
    if (root) {
      // Only fade the framing copy + CTA, not the ticket (handled above).
      const fadeEls = root.querySelectorAll(
        '.draw-sealed-header, .draw-reveal-cta'
      )
      gsap.to(fadeEls,
        { opacity: 0, duration: 0.3, ease: 'power2.in', delay: 0.1 }
      )
    }
    // Hand off after the zoom completes. The lane scene's entrance
    // begins fading in immediately (it's a separate React subtree)
    // so the two fades cross naturally.
    window.setTimeout(onReveal, 550)
  }

  return (
    <div className="draw-sealed" ref={rootRef}>
      <div className="draw-pattern-bg" aria-hidden="true" />

      <div className="draw-sealed-header">
        <div className="draw-sealed-eyebrow">Weekly Member Draw</div>
        <div className="draw-sealed-sub">
          {winnerCount} winners drawn
          {' '}<InfoTip title={CONCEPTS.prizeDraw.title} body={CONCEPTS.prizeDraw.body} label="How does the prize draw work?" />
        </div>
      </div>

      <div className="draw-sealed-ticket-wrap">
        <div className="draw-sealed-ticket" ref={ticketRef}>
          <img
            className="draw-sealed-ticket-img"
            src={assets.ticketLandscape}
            alt=""
            draggable={false}
          />
          <div className="draw-sealed-ticket-stamp">
            <div className="draw-sealed-ticket-header">
              <div className="draw-sealed-ticket-title">POLKADOT PRIZES</div>
              <div className="draw-sealed-ticket-meta">Your Entry</div>
            </div>
            <div className="draw-sealed-ticket-code">
              {formatTicketLong(userTicket)}
            </div>
          </div>
          <div
            className="draw-sealed-ticket-seal"
            ref={sealRef}
            aria-hidden="true"
            style={{
              // Mask the sweep to the ticket's own silhouette (same asset as
              // the ticket image) so the shine only crosses the ticket art,
              // not the transparent corners of its bounding box.
              WebkitMaskImage: `url(${assets.ticketLandscape})`,
              maskImage: `url(${assets.ticketLandscape})`
            }}
          />
        </div>
      </div>

      <button
        type="button"
        className="draw-reveal-cta cta-primary"
        onClick={handleReveal}
        disabled={!ctaReady}
      >
        REVEAL
      </button>
    </div>
  )
}
