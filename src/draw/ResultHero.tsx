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
import { sfx } from '../audio/engine'
import { haptic } from '../haptics/engine'

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

// Inline SVG coin detail (rim + inner ring + sparkle + sheen) layered over the
// CSS gold-gradient body, so the coins read as minted gold tokens rather than
// plain dots — without a raster asset (crisp at any size, tintable, stays in
// the single-file bundle). No <defs>/IDs, so repeating it across the flying
// coins + chip glyph can't create duplicate-ID collisions.
const COIN_SVG =
  '<svg viewBox="0 0 32 32" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
  '<circle cx="16" cy="16" r="15" fill="none" stroke="#9c6420" stroke-width="1.4" stroke-opacity="0.5"/>' +
  '<circle cx="16" cy="16" r="11" fill="none" stroke="#fff2c4" stroke-width="1" stroke-opacity="0.4"/>' +
  '<path d="M16 9.5 L17.4 14.6 L22.5 16 L17.4 17.4 L16 22.5 L14.6 17.4 L9.5 16 L14.6 14.6 Z" fill="#8a5a1c" fill-opacity="0.5"/>' +
  '<ellipse cx="11.5" cy="10.5" rx="5" ry="3.2" fill="#ffffff" opacity="0.4"/>' +
  '</svg>'

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
  // CASH deposit beat (win only): the winning ticket "pays out" gold coins
  // that arc into the balance chip, which ticks up to the prize.
  const chipRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLSpanElement>(null)
  const coinLayerRef = useRef<HTMLDivElement>(null)
  const [ctaReady, setCtaReady] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [countdown, setCountdown] = useState(() => formatCountdown(draw.nextDrawAt))

  // Tick the countdown once a minute. Cheap, doesn't need second-level
  // precision on this screen.
  useEffect(() => {
    const t = window.setInterval(() => setCountdown(formatCountdown(draw.nextDrawAt)), 60_000)
    return () => window.clearInterval(t)
  }, [draw.nextDrawAt])

  // ── CASH deposit (win only) ───────────────────────────────────────────
  // After the ticket flip, the winning ticket "pays out": a burst of gold
  // coin-discs arcs from the ticket into the balance chip (reusing the badge
  // arc-fly gesture), the chip's amount ticks up to the prize, and it lands
  // with a pulse + dust + chime + haptic. Conveys "real CASH added to your
  // balance" without a tooltip. Reduced motion: the chip just shows the final
  // amount. All coin DOM + tweens are tracked and killed on unmount.
  useEffect(() => {
    if (outcome !== 'win') return
    const amount = amountRef.current
    if (!amount) return
    const prize = Number.isFinite(draw.prizeUsd) && draw.prizeUsd >= 0 ? draw.prizeUsd : 0
    const fmt = (n: number) => `+${Math.round(n).toLocaleString()} CASH`

    if (reduced) {
      amount.textContent = fmt(prize)
      return
    }
    amount.textContent = ''

    const anims: gsap.core.Animation[] = []
    const coins: HTMLElement[] = []
    let cancelled = false

    const run = () => {
      if (cancelled) return
      const root = rootRef.current
      const chip = chipRef.current
      const layer = coinLayerRef.current
      if (!root || !chip || !layer) { amount.textContent = fmt(prize); return }
      const rootR = root.getBoundingClientRect()
      const chipR = chip.getBoundingClientRect()
      const srcR = (ticketRef.current ?? chip).getBoundingClientRect()
      const sx = srcR.left + srcR.width / 2 - rootR.left
      const sy = srcR.top + srcR.height / 2 - rootR.top
      const dx = chipR.left + chipR.width / 2 - rootR.left
      const dy = chipR.top + chipR.height / 2 - rootR.top

      // A few BIG coins that tumble in slowly and land one at a time. Each
      // landing bumps the balance, nudges the chip, and ticks — so the number
      // visibly climbs as the coins drop in (the satisfying part). Fewer +
      // bigger + slower + spinning reads as coins, not confetti.
      const COINS = 7
      const step = prize / COINS
      let landed = 0

      for (let i = 0; i < COINS; i++) {
        const coin = document.createElement('span')
        coin.className = 'cash-coin-fly'
        coin.innerHTML = COIN_SVG
        layer.appendChild(coin)
        coins.push(coin)
        const spread = ((i % 4) - 1.5) * 26
        const peakY = Math.min(sy, dy) - 78 - (i % 3) * 22
        const spin = (i % 2 === 0 ? 1 : -1) * (360 + (i % 3) * 180)
        gsap.set(coin, { x: sx + spread, y: sy, scale: 0.5, opacity: 0, rotateY: 0 })
        const tl = gsap.timeline({ delay: i * 0.14, onComplete: () => coin.remove() })
        // Pop out of the ticket with weight.
        tl.to(coin, { opacity: 1, scale: 1, duration: 0.22, ease: 'back.out(2)' }, 0)
        // Arc up, tumbling.
        tl.to(coin, { x: (sx + dx) / 2 + spread * 0.4, y: peakY, rotateY: spin * 0.5, duration: 0.52, ease: 'power2.out' }, 0)
        // Fall into the chip, shrinking so it pours in.
        tl.to(coin, { x: dx, y: dy, rotateY: spin, scale: 0.42, duration: 0.52, ease: 'power2.in' })
        // Land: bump the balance + nudge the chip + tick.
        tl.add(() => {
          landed += 1
          const last = landed >= COINS
          amount.textContent = fmt(last ? prize : step * landed)
          sfx.play('badge-land')   // engine throttles repeats → a coin patter
          haptic.play('tap-store')
          gsap.fromTo(chip, { scale: 1 }, {
            scale: last ? 1.16 : 1.06, duration: 0.13, yoyo: true, repeat: 1, ease: 'power2.out'
          })
          if (last) particlesRef.current?.dustBurst(dx, dy, [255, 215, 110])
        })
        tl.to(coin, { opacity: 0, scale: 0.2, duration: 0.16 })
        anims.push(tl)
      }
    }

    // Hold until the ticket flip has settled, then pay out.
    const kickoff = gsap.delayedCall(0.85, run)

    return () => {
      cancelled = true
      kickoff.kill()
      anims.forEach((a) => a.kill())
      coins.forEach((c) => c.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, reduced])

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
      ? `You won, lucky #${rank} of ${draw.winningTickets.length}`
      : 'You won'
    // CASH is credited automatically by native — the user does nothing to
    // claim it. So the CTA just continues the flow; saying "Claim my X CASH"
    // would imply tapping is what pays them, which is false.
    ctaLabel = 'Continue'
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

      {/* Particle layer — loss path, plus the small dust puff when the win
          deposit lands in the balance chip. */}
      <ParticleCanvas ref={particlesRef} />

      {/* Layer the CASH coins fly through on their way to the balance chip. */}
      {outcome === 'win' && (
        <div className="cash-fly-layer" ref={coinLayerRef} aria-hidden="true" />
      )}

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
                  {displayName || 'Your entry'}
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
            You're a member now
          </div>
          <div
            className="draw-consolation-body"
            data-ready={ctaReady ? 'true' : 'false'}
          >
            Better luck on the draw next time.
          </div>
        </>
      )}

      {/* Bottom note, just above the CTA:
          - WIN: confirm the CASH is already theirs (auto-credited by native).
            No countdown here — they just won; next-draw timing is secondary,
            and this slot keeps the note clear of the lifted hero ticket.
          - LOSS: the next-draw countdown, the one forward-looking detail. */}
      {outcome === 'win' ? (
        <div className="cash-deposit">
          <div className="cash-chip" ref={chipRef}>
            <span className="cash-coin" aria-hidden="true" dangerouslySetInnerHTML={{ __html: COIN_SVG }} />
            <span className="cash-amount" ref={amountRef} aria-hidden="true" />
          </div>
          <div className="cash-deposit-note">added to your balance</div>
        </div>
      ) : countdown ? (
        <div className="draw-result-countdown" aria-live="off">
          Next draw in <span className="draw-result-countdown-value">{countdown}</span>
        </div>
      ) : null}

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
