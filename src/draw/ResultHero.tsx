// ResultHero — post-draw result. Win or loss, hero ticket + headline +
// supporting copy + CTA + countdown to the next draw.
//
// Win path:
//   - Big prize amount as the headline (96pt Mulish 900, gold gradient)
//   - "You won" subhead
//   - "Lucky #N of 20" subhead — N derived by sorting winningTickets
//     against userTicket (lexicographic distance proxy; in practice
//     native could pass winRank explicitly, but it's derivable)
//   - Hero ticket (gold) as supporting evidence
//   - Particle finale (legendaryBurst + legendaryFollowup)
//   - "Claim my X CASH" CTA
//
// Loss path:
//   - "no win this time" headline — neutral, doesn't imply distance
//   - Hero ticket (spent appearance — desat, slight rotation, no aura)
//   - "Continue" CTA
//   - Consolation overlay if justBecameMember && !won
//
// Loss copy intentionally omits any reference to distance ("so close",
// "miles away", "tickets behind") — the chain doesn't currently expose
// a real ticket-distance value, so claiming a specific magnitude would
// mislead. The visual scroll length in LaneScene gives an honest
// directional cue without numerical claims.
//
// Countdown to next draw is shown on both paths as a tasteful detail.

import { useEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'
import { formatTicketLong } from './ticketDisplay'
import { outcomeFor, type EffectiveDraw } from './types'
import type { DrawAssets } from './assets'
import ParticleCanvas, { type ParticleCanvasApi } from '../components/ParticleCanvas'

interface ResultHeroProps {
  draw: EffectiveDraw
  assets: DrawAssets
  displayName?: string
  justBecameMember?: boolean
  onContinue: () => void
}

// Prize display unit. The `prizeUsd` field on the bridge is a holdover
// from when the design was dollar-denominated; the prize is displayed as
// "CASH". Field name will be revised on the next contract change; keep the
// formatter local so swapping the unit is a one-line edit.
function formatPrize(amount: number): string {
  // Guard against a non-finite / negative prizeUsd from native — never
  // render "NaN CASH" / "-5 CASH" (or throw on undefined.toLocaleString()).
  const n = Number.isFinite(amount) && amount >= 0 ? amount : 0
  return `${n.toLocaleString()} CASH`
}

/** Derive the user's "Lucky #N of 20" position on win. Sorts the winners
 *  lexicographically and finds the user's slot. Doesn't matter what the
 *  sort order is — only matters that it's stable per-draw. Returns -1 when
 *  the user's ticket ISN'T in the list (a won/winningTickets mismatch), so
 *  the caller shows a bare "You won" instead of fabricating "#1 of N". */
function deriveWinRank(userTicket: string, winningTickets: string[]): number {
  const sorted = [...winningTickets].sort()
  const idx = sorted.findIndex(t => t === userTicket)
  return idx >= 0 ? idx + 1 : -1
}

// Once nextDrawAt is more than this far in the past we treat it as stale
// schedule data (native didn't refresh it) and hide the row, rather than
// showing "drawing now" indefinitely. A real draw "happening now" resolves
// well within this window.
const COUNTDOWN_STALE_GRACE_MS = 15 * 60_000

function formatCountdown(targetIso: string): string {
  const target = new Date(targetIso).getTime()
  // Missing/invalid nextDrawAt → empty string; the caller hides the row
  // rather than rendering "Next draw in NaNm".
  if (!Number.isFinite(target)) return ''
  const now = Date.now()
  const ms = target - now
  // Stale (long past) → hide the row rather than say "drawing now" forever.
  if (ms <= -COUNTDOWN_STALE_GRACE_MS) return ''
  if (ms <= 0) return 'drawing now'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function ResultHero({
  draw,
  assets,
  displayName,
  justBecameMember,
  onContinue
}: ResultHeroProps) {
  const outcome = useMemo(() => outcomeFor(draw), [draw])
  const reduced = prefersReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const ticketRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const beamsRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<ParticleCanvasApi>(null)
  const [ctaReady, setCtaReady] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [countdown, setCountdown] = useState(() => formatCountdown(draw.nextDrawAt))

  // Tick the countdown once a minute. Cheap, doesn't need second-level
  // precision on this screen.
  useEffect(() => {
    const t = window.setInterval(() => setCountdown(formatCountdown(draw.nextDrawAt)), 60_000)
    return () => window.clearInterval(t)
  }, [draw.nextDrawAt])

  // Entrance.
  useEffect(() => {
    if (reduced) {
      // subRef only mounts when subText is present; filter nulls so gsap.set
      // never gets a null target (it throws on null inside an array).
      const els = [rootRef.current, headlineRef.current, subRef.current, ticketRef.current, ctaRef.current].filter(Boolean)
      gsap.set(els, { opacity: 1, y: 0, scale: 1 })
      setCtaReady(true)
      return
    }

    const tl = gsap.timeline()
    tl.fromTo(rootRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.4, ease: 'power2.out' }
    )
    if (ticketRef.current) {
      // Both WIN and LOSS hand off from LaneScene's detach+lift, which
      // has already placed a ticket element at the EXACT pixel position
      // + orientation the hero ticket will render at. So in both cases
      // we set opacity:1 instantly — any entrance animation would
      // visually fight the lifted ticket that's still on screen during
      // the handoff frame.
      //
      // Headline + sub + CTA still fade in AROUND the static ticket.
      gsap.set(ticketRef.current, { opacity: 1, scale: 1, y: 0 })
    }
    if (headlineRef.current) {
      tl.fromTo(headlineRef.current,
        { opacity: 0, scale: 0.92, y: -10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.6)' },
        '-=0.3'
      )
    }
    if (subRef.current) {
      tl.fromTo(subRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
        '-=0.3'
      )
    }
    if (ctaRef.current) {
      tl.fromTo(ctaRef.current,
        { opacity: 0, y: 10 },
        {
          opacity: 1, y: 0, duration: 0.45, ease: 'power2.out',
          onComplete: () => setCtaReady(true)
        },
        '-=0.1'
      )
    }

    // Win finale — light beams ramp in behind the hero ticket, the
    // gold-faced ticket flips to reveal the "you won" winning art,
    // gentle brightness pulse scoped to the headline, then the ticket
    // settles into a continuous gentle float.
    let floatTween: gsap.core.Tween | null = null
    if (outcome === 'win') {
      if (beamsRef.current) {
        tl.fromTo(beamsRef.current,
          { opacity: 0, scale: 0.85 },
          { opacity: 0.85, scale: 1, duration: 0.9, ease: 'power3.out' },
          0.1
        )
      }
      // Flip the hero ticket to reveal the winning art ~400ms after
      // mount. Continuous physical-object beat: the gold ticket just
      // landed from the lane scene's lift; now it flips to its winning
      // face. Class toggle drives the CSS rotateY transform.
      tl.add(() => setFlipped(true), 0.45)
      // Subtle brightness pulse — scoped to just the headline so the
      // browser only has to re-rasterize that one element, not the
      // whole result tree.
      if (headlineRef.current) {
        tl.fromTo(headlineRef.current,
          { filter: 'brightness(1)' },
          { filter: 'brightness(1.18)', duration: 0.25, ease: 'power2.out' },
          0.55
        )
        tl.to(headlineRef.current,
          { filter: 'brightness(1)', duration: 0.45, ease: 'power2.in' },
          0.85
        )
      }
      // Gentle float — kick off AFTER the flip settles (~1.4s) so the
      // float doesn't compete with the flip's rotateY motion. Sine
      // ease gives the classic "hovering" feel: ticket drifts up 10px,
      // back down, infinite yoyo. The ticket's CSS rest position uses
      // `transform: translate(-50%, -50%)` which sets xPercent/yPercent
      // — GSAP's `y` (pixels) layers on top of that without
      // overriding the centering. Held in a ref so we can kill it on
      // unmount.
      if (ticketRef.current) {
        floatTween = gsap.to(ticketRef.current, {
          y: -10,
          duration: 2.2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: 1.4
        })
      }
    }

    return () => {
      tl.kill()
      if (floatTween) floatTween.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, outcome])

  // Copy + CTA label per outcome.
  let headlineText: string
  let subText: string
  let ctaLabel: string
  if (outcome === 'win') {
    headlineText = formatPrize(draw.prizeUsd)
    // Only claim a placement when there's a real winner set AND the user's
    // ticket is actually in it — otherwise a bare "You won" (never "#1 of 0",
    // and never a fabricated rank when won:true contradicts winningTickets).
    const rank = draw.winningTickets.length > 0
      ? deriveWinRank(draw.userTicket, draw.winningTickets)
      : -1
    subText = rank > 0
      ? `You won — lucky #${rank} of ${draw.winningTickets.length}`
      : 'You won'
    ctaLabel = `Claim my ${formatPrize(draw.prizeUsd)}`
  } else {
    // Single LOSS branch (lose-near and lose-far share copy). No
    // distance language — ticketDistance is currently webview-simulated
    // and we don't claim numbers we don't have. The countdown to the
    // next draw is shown below the CTA; that's the only forward-looking
    // info we surface here.
    headlineText = 'no win this time'
    subText = ''
    ctaLabel = 'Continue'
  }

  return (
    <div
      className={`draw-result ${outcome === 'win' ? 'is-win' : 'is-loss'}`}
      ref={rootRef}
    >
      <div className="draw-pattern-bg" aria-hidden="true" />

      {/* Light beams (god-rays) — only rendered on win. CSS conic
          gradient + soft blur; rotates slowly so it feels alive. */}
      {outcome === 'win' && (
        <div className="draw-result-beams" ref={beamsRef} aria-hidden="true" />
      )}

      {/* Particle layer — kept for loss-path use; win path no longer
          spawns a burst here (the lift's apex burst is plenty). */}
      <ParticleCanvas ref={particlesRef} />

      {/* Headline — prize amount on win, copy on loss. */}
      <div className="draw-result-headline" ref={headlineRef}>
        {headlineText}
      </div>
      {subText && (
        <div className="draw-result-sub" ref={subRef}>
          {subText}
        </div>
      )}

      {/* Hero ticket.
          WIN: two-faced flip card showing the clean ticket art only
          (no overlay). Front = goldenLandscape (matches the lifted
          ticket from the lane scene → visually continuous when
          ResultHero mounts). Back = winningLandscape ("you won" art).
          Mounts showing front; flips to back at +0.45s.
          The ticket-info block below renders the user's number +
          display name as its own section so the ticket art stays
          unobstructed.
          LOSS: single ticket with spent appearance + in-ticket stamp
          (loss layout still uses the stamp overlay since the info
          isn't a focal moment for the loss path). */}
      <div
        className={`draw-result-ticket ${outcome === 'win' && flipped ? 'is-flipped' : ''}`}
        ref={ticketRef}
      >
        {outcome === 'win' ? (
          <div className="draw-result-ticket-flip">
            <div className="draw-result-ticket-face draw-result-ticket-face--front">
              <img
                className="draw-result-ticket-bg"
                src={assets.goldenLandscape}
                alt=""
                draggable={false}
              />
            </div>
            <div className="draw-result-ticket-face draw-result-ticket-face--back">
              <img
                className="draw-result-ticket-bg"
                src={assets.winningLandscape}
                alt=""
                draggable={false}
              />
            </div>
          </div>
        ) : (
          <>
            <img
              className="draw-result-ticket-bg"
              src={assets.ticketLandscape}
              alt=""
              draggable={false}
            />
            <div className="draw-result-ticket-stamp">
              <div className="draw-result-ticket-header">
                <div className="draw-result-ticket-title">POLKADOT PRIZES</div>
                <div className="draw-result-ticket-meta">
                  {displayName || 'Your Entry'}
                </div>
              </div>
              <div className="draw-result-ticket-code">
                {formatTicketLong(draw.userTicket)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Win-only ticket info block — sits below the hero ticket so the
          ticket art reads as a clean physical object (it's the "you
          won" reveal; piling text on it competes with that moment). */}
      {outcome === 'win' && (
        <div className="draw-result-ticket-info">
          <div className="draw-result-ticket-info-code">
            {formatTicketLong(draw.userTicket)}
          </div>
          <div className="draw-result-ticket-info-meta">
            POLKADOT PRIZES{displayName ? ` · ${displayName}` : ''}
          </div>
        </div>
      )}

      {/* New-member consolation — only on loss when this game's win
          was their personhood transition. Split into two pieces so
          membership-unlocked reads as the headline moment ABOVE the
          ticket (it's a real achievement, not a footnote), and the
          "better luck" body reads as a quieter aside BELOW the ticket.
          Both share the ctaReady gate so they fade in together with
          the rest of the screen. */}
      {outcome !== 'win' && justBecameMember && (
        <>
          <div
            className="draw-consolation-eyebrow"
            data-ready={ctaReady ? 'true' : 'false'}
            aria-live="polite"
          >
            Membership unlocked
          </div>
          <div
            className="draw-consolation-body"
            data-ready={ctaReady ? 'true' : 'false'}
          >
            Better luck on the draw next time.
          </div>
        </>
      )}

      {countdown && (
        <div className="draw-result-countdown" aria-live="off">
          Next draw in <span className="draw-result-countdown-value">{countdown}</span>
        </div>
      )}

      <button
        type="button"
        className={`draw-result-cta ${outcome === 'win' ? 'is-claim' : ''}`}
        ref={ctaRef}
        onClick={onContinue}
        disabled={!ctaReady}
      >
        {ctaLabel}
      </button>
    </div>
  )
}
