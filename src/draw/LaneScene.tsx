// LaneScene — the 3D perspective lane of tickets that IS the draw.
//
// What lives here:
//   - The perspective DOM scaffold (rotateX 62deg tilted plane + camera
//     rig that translates along the lane axis)
//   - Ticket placement (winners + user + sampled anons) computed from
//     bridge data via `src/draw/positioning.ts`
//   - The cut-line element that descends through the plane to mark the
//     draw cutoff (replaces the prototype's pivot bar HUD)
//   - The master GSAP timeline orchestrating: stage-in → opening close-up
//     → pull-back → cut-line descent + lock → gold cascade ignite →
//     outcome-specific finale (win lift / lose-near settle / lose-far
//     scroll with distance counter)
//   - The YOU marker (pulsing ring + optional display-name chevron)
//   - The lose-far distance counter overlay
//
// Reduced motion is handled by the parent (PrizeDrawScreen): if active,
// the parent skips this stage entirely and renders the result directly.

import { memo, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'
import {
  LANE_X, getWinnerPositions, getUserLossPosition, getUserWinPosition,
  getAnonPositions, getMiddleTileBounds, cutlineY, TICKET_HEIGHT,
  type MiddleTileBounds
} from './positioning'
import { formatTicketShort } from './ticketDisplay'
import { outcomeFor, type DrawOutcome, type LaneTicket, type EffectiveDraw } from './types'
import type { DrawAssets } from './assets'
import ParticleCanvas, { type ParticleCanvasApi } from '../components/ParticleCanvas'

interface LaneSceneProps {
  draw: EffectiveDraw
  assets: DrawAssets
  displayName?: string
  /** Fires when the entire lane-scene timeline finishes — parent
   *  transitions to the result stage. */
  onComplete: () => void
}

// Hash a string for deterministic anon ticket "codes" — purely visual,
// not a real ticket hash. Just so the lane scene doesn't show the same
// 4 chars on every anon.
function pseudoHash(seed: number): string {
  let h = seed >>> 0
  let s = ''
  for (let i = 0; i < 32; i++) {
    h = (h * 1664525 + 1013904223) >>> 0
    s += (h & 0xff).toString(16).padStart(2, '0')
  }
  return s
}

export default function LaneScene({ draw, assets, displayName, onComplete }: LaneSceneProps) {
  const outcome: DrawOutcome = useMemo(() => outcomeFor(draw), [draw])
  const winnerCount = draw.winningTickets.length

  // ROW_SPACING / 2 — used for the middle-lane brick stagger in the
  // tile-bg layer.
  const ROW_SPACING_HALF = 100

  // Build the static scene model once per draw — list of tickets to
  // render plus their target lane positions. The user ticket is either
  // a winner-slot (win) or a separate ticket behind the band (lose).
  const tickets: LaneTicket[] = useMemo(() => {
    const out: LaneTicket[] = []
    const winnerPositions = getWinnerPositions(winnerCount)
    const userWinPos = outcome === 'win' ? getUserWinPosition(winnerCount) : null
    const userLossPos = outcome !== 'win' ? getUserLossPosition(draw.ticketDistance, winnerCount) : null

    // Winners — substitute the user-winner slot if the user is one.
    for (let i = 0; i < winnerCount; i++) {
      const pos = winnerPositions[i]!
      const isUserSlot = userWinPos
        && pos.lane === userWinPos.lane
        && pos.y === userWinPos.y
      let hash = isUserSlot ? draw.userTicket : (draw.winningTickets[i] ?? pseudoHash(i + 7000))
      // On a loss, never light the user's OWN ticket code among the winners.
      // `won` is authoritative (they didn't win), so showing their
      // recognizable code in the gold cascade would contradict the verdict
      // (e.g. won:false but userTicket happens to be in winningTickets).
      if (!isUserSlot && outcome !== 'win' && hash === draw.userTicket) {
        hash = pseudoHash(i + 9000)
      }
      out.push({
        id: `winner-${i}`,
        kind: isUserSlot ? 'user-winner' : 'winner',
        hash,
        position: pos
      })
    }

    // User-on-loss as a separate ticket.
    if (userLossPos) {
      out.push({
        id: 'user',
        kind: 'user',
        hash: draw.userTicket,
        position: userLossPos
      })
    }

    // Anonymous filler. Skip any anon that would collide with the user
    // ticket (same lane, within TICKET_HEIGHT). Winners already occupy
    // their own positions and anons are placed BEHIND the band, so no
    // collision check vs winners is needed.
    const anonPositions = getAnonPositions(
      userLossPos ? userLossPos.y : 0,
      winnerCount
    )
    let seed = 1
    for (const pos of anonPositions) {
      if (userLossPos && pos.lane === userLossPos.lane
          && Math.abs(pos.y - userLossPos.y) < TICKET_HEIGHT) {
        continue
      }
      out.push({
        id: `anon-${seed}`,
        kind: 'anon',
        hash: pseudoHash(seed * 31),
        position: pos
      })
      seed++
    }

    return out
  }, [draw, outcome, winnerCount])

  // Where the camera needs to be Y-wise for various focal points. The
  // camera translateY centers a given lane-Y at screen middle:
  //   effective_Y = ticket_y + camera_translateY
  // so to center ticket_y on screen: camera_translateY = -ticket_y
  const cameraAtUser = useMemo(() => {
    const userTicket = tickets.find(t => t.kind === 'user' || t.kind === 'user-winner')
    return userTicket ? -userTicket.position.y : 0
  }, [tickets])
  const cameraAtBand = 0  // band front row at y=0

  // The MIDDLE stretch between the band's dense-back zone and the
  // user's dense zone is rendered as a tiled background image instead
  // of hundreds of real DOM tickets. Cheap to render, indistinguishable
  // at camera scroll speed. Null for short losses where the dense
  // zones already cover everything.
  const middleTile: MiddleTileBounds | null = useMemo(() => {
    if (outcome === 'win') return null
    const userLossTicket = tickets.find(t => t.kind === 'user')
    if (!userLossTicket) return null
    return getMiddleTileBounds(userLossTicket.position.y, winnerCount)
  }, [tickets, outcome, winnerCount])

  const cameraRef = useRef<HTMLDivElement>(null)
  const cutlineRef = useRef<HTMLDivElement>(null)
  const youChevronRef = useRef<HTMLDivElement>(null)
  const spotlightRef = useRef<HTMLDivElement>(null)
  const cinematicTextRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const particlesRef = useRef<ParticleCanvasApi>(null)
  const ticketRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // NOTE: The "X tickets behind" counter has been removed because the
  // chain doesn't yet expose a real ticket-distance value (the value
  // is currently webview-simulated; see src/draw/ticketDistance.ts).
  // Showing a fake number to the user would mislead them. The camera's
  // scroll-back length still scales with the simulated value, so the
  // user gets a VISUAL sense of how far they were without any claim
  // about a specific count. When chain support lands, restore the
  // counter by reinstating `farCounterRef`, `farCounterValue` state,
  // the JSX block, and the timeline tween — all of them are kept in
  // git history; this commit removes them as a single coherent unit.

  /** Stable ref-registration callback. Identity is preserved across
   *  re-renders so memoized TicketEl props don't change → no spurious
   *  re-renders that would strip imperative class additions like
   *  `is-gold`. */
  const registerTicketRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) ticketRefs.current[id] = el
    else delete ticketRefs.current[id]
  }, [])

  /** Helper: get a ticket element's CURRENT screen-space center, used
   *  by particle spawns + the lift's hero-target measurement. Reads
   *  layout via getBoundingClientRect so it accounts for the tilted
   *  perspective + camera translateY. */
  function ticketScreenCenter(id: string): { x: number; y: number } | null {
    const el = ticketRefs.current[id]
    const root = rootRef.current
    if (!el || !root) return null
    const r = el.getBoundingClientRect()
    const rootR = root.getBoundingClientRect()
    return {
      x: r.left + r.width / 2 - rootR.left,
      y: r.top + r.height / 2 - rootR.top
    }
  }

  // Master timeline. One labeled GSAP timeline owns the entire ceremony
  // so easings flow continuously instead of butting against each other.
  useEffect(() => {
    if (prefersReducedMotion()) {
      // Reduced-motion safety net: parent should skip this stage, but
      // if we're here, just fire onComplete immediately.
      onComplete()
      return
    }

    const tl = gsap.timeline()
    // The detach+lift tween (win OR loss) runs on the GLOBAL gsap, not on
    // `tl` — its landing target is measured at runtime inside a timeline
    // callback, so it can't be queued on the master timeline up front. That
    // means `tl.kill()` alone wouldn't stop it; track it here and kill it in
    // cleanup so it can't keep animating a detached element after unmount.
    let liftTween: gsap.core.Tween | null = null

    // ── Stage in: tickets fade in around the user ────────────────────
    // Open close-up: camera already at the user's Y. Tickets near the
    // user appear first; distant ones stagger in. Stagger TIME is
    // capped at MAX_STAGGER_S regardless of ticket count — the lose-
    // far scenario can have 1000+ anons, and the prior fixed 0.012s
    // per ticket would have stretched the entrance to 12+ seconds.
    gsap.set(cameraRef.current, { y: cameraAtUser })
    const userY = -cameraAtUser
    const sortedByDistance = tickets
      .map((t) => ({ t, dist: Math.abs(t.position.y - userY) }))
      .sort((a, b) => a.dist - b.dist)
    const MAX_STAGGER_S = 1.0
    const perTicketStagger = Math.min(
      0.012,
      MAX_STAGGER_S / Math.max(1, sortedByDistance.length - 1)
    )
    sortedByDistance.forEach(({ t }, i) => {
      const el = ticketRefs.current[t.id]
      if (!el) return
      tl.fromTo(el,
        { opacity: 0, scale: 0.6 },
        { opacity: 0.96, scale: 1, duration: 0.5, ease: 'power2.out' },
        i * perTicketStagger
      )
    })

    // Spotlight fades in — tight cone of light frames the user's ticket
    // against the dim crowd. Cinematic "look at YOUR ticket" beat.
    if (spotlightRef.current) {
      tl.fromTo(spotlightRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.55, ease: 'power2.out' },
        0.35
      )
    }
    if (youChevronRef.current) {
      tl.fromTo(youChevronRef.current,
        { opacity: 0, y: -8 },
        { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
        0.5
      )
    }

    // ── Pull back: camera retreats to expose the band ────────────────
    // Camera travels from the user's position all the way to the BAND
    // (cameraAtBand = 0), regardless of distance. This guarantees the
    // cut-line + cascade are always framed correctly — for lose-far,
    // the camera traverses the entire procession in 1.0s (fast, blurs
    // past), and for lose-near it's a short glide. Either way, by the
    // time the cut-line descends, the band is dead-center on screen.
    //
    // The procession length IS visible during this transit. That's OK
    // — the suspense moment is "will my ticket ignite gold?", not
    // "how far am I from the band". The cascade resolves the former;
    // the post-cascade scroll-back resolves the latter.
    //
    // Spotlight cuts SHARPLY the moment the camera starts moving — a
    // slow fade competed with the band's reveal. Fast 0.3s ease reads
    // as "spotlight off, look at the world now".
    if (spotlightRef.current) {
      tl.to(spotlightRef.current,
        { opacity: 0, duration: 0.3, ease: 'power2.in' },
        1.1
      )
    }
    tl.to(cameraRef.current,
      { y: cameraAtBand, duration: 1.0, ease: 'power3.out' },
      1.1
    )

    // ── Cut-line: descend through the plane and lock ─────────────────
    // Telegraph (0.3s), descent (0.6s) in power3.in, lock flash (0.15s).
    // The cut-line position is fixed in lane space; we ANIMATE it from
    // far above the plane down to its target Y.
    if (cutlineRef.current) {
      gsap.set(cutlineRef.current, { y: cutlineY(winnerCount) + 1400, opacity: 0 })
      tl.to(cutlineRef.current,
        { opacity: 0.55, duration: 0.3, ease: 'power2.out' },
        2.3
      )
      tl.to(cutlineRef.current,
        { y: cutlineY(winnerCount), opacity: 1, duration: 0.6, ease: 'power3.in' },
        2.55
      )
      // Lock bloom on the line itself.
      tl.to(cutlineRef.current,
        { opacity: 1.2, duration: 0.08, yoyo: true, repeat: 1, ease: 'power2.out' },
        3.15
      )
    }

    // "drawing" cinematic text — the one and only mid-flow overlay.
    // Fires at the cut-line lock moment, fades out as the cascade begins.
    if (cinematicTextRef.current) {
      tl.fromTo(cinematicTextRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' },
        3.15
      )
      tl.to(cinematicTextRef.current,
        { opacity: 0, duration: 0.35, ease: 'power2.in' },
        3.7
      )
    }

    // ── Gold cascade: ignite the 20 winners ──────────────────────────
    // 0.13s stagger × 19 ≈ 2.5s, bigger pulse than the prototype.
    const winnerEls = tickets
      .filter(t => t.kind === 'winner' || t.kind === 'user-winner')
      .map(t => ticketRefs.current[t.id])
      .filter(Boolean) as HTMLDivElement[]
    const IGNITE_START = 3.4
    const IGNITE_STAGGER = 0.13
    const winnerIds = tickets
      .filter(t => t.kind === 'winner' || t.kind === 'user-winner')
      .map(t => t.id)
    winnerEls.forEach((el, i) => {
      const at = IGNITE_START + i * IGNITE_STAGGER
      tl.add(() => {
        el.classList.add('is-gold')
        // Per-ticket sparkle puff — gold spreads like fire. Spawn
        // on every 3rd ticket only (vs every ticket); the visual
        // density is still continuous because adjacent ignitions
        // are ~390ms apart and each burst lingers for ~1.5s, but
        // total particle budget drops 3× (mobile-friendly).
        if (i % 3 === 0) {
          const center = ticketScreenCenter(winnerIds[i]!)
          if (center && particlesRef.current) {
            particlesRef.current.dustBurst(center.x, center.y, [255, 200, 100])
          }
        }
      }, at)
      tl.fromTo(el,
        { scale: 1 },
        { scale: 1.12, duration: 0.22, yoyo: true, repeat: 1, ease: 'power2.out' },
        at
      )
    })
    const igniteEnd = IGNITE_START + (winnerEls.length - 1) * IGNITE_STAGGER + 0.22

    // ── Outcome-specific finale ──────────────────────────────────────
    if (outcome === 'win') {
      // Find the user's winner ticket; hero-pulse it brighter than the
      // rest so it's clearly "the user's win" not just "a win".
      const userWinTicket = tickets.find(t => t.kind === 'user-winner')
      const userEl = userWinTicket ? ticketRefs.current[userWinTicket.id] : null
      if (userEl) {
        tl.add(() => userEl.classList.add('is-hero-winner'), igniteEnd + 0.2)
        tl.to(userEl,
          { scale: 1.18, duration: 0.4, ease: 'power2.out' },
          igniteEnd + 0.2
        )
      }
      // Camera nudges to center user (small move since user is in band).
      tl.to(cameraRef.current,
        { y: cameraAtUser, duration: 0.8, ease: 'power2.inOut' },
        igniteEnd + 0.3
      )
      // Dim the other winners + anons so the user's ticket pops.
      tl.to('.draw-lane-ticket:not(.is-hero-winner)',
        { opacity: 0.18, duration: 0.5, ease: 'power2.out' },
        igniteEnd + 0.8
      )

      // ── Lift sequence — designed to be ONE continuous gesture from
      //    the user's lane position to the hero ticket's landing spot,
      //    so ResultHero takes over with the ticket already in place.
      //    Four steps, but no easing-curve seams between them:
      //
      //    PHASE 0 (0.4s): counter-tilt the user ticket in lane space.
      //      rotateX -62 cancels the perspective rig's +62 tilt → ticket
      //      faces the camera. Still inside the rig at this point.
      //
      //    DETACH (instant): reparent to .draw-flat-layer (sibling of
      //      the perspective rig). Because Phase 0 ended with the ticket
      //      already face-on at screen center, the visual state is
      //      identical before/after detach → no pop.
      //
      //    PHASE 1+2 (1.0s): in flat 2D now. Translate to the hero's
      //      landing Y, rotate 90° CW (portrait → landscape so the
      //      ticket orientation matches ResultHero's hero), scale up to
      //      hero dimensions. End state matches ResultHero's hero ticket
      //      exactly — when ResultHero mounts, the visual is continuous.
      if (userEl && rootRef.current) {
        const flatLayer = rootRef.current.querySelector<HTMLDivElement>('.draw-flat-layer')

        // Pre-warm the GPU layer so the upcoming 3D transform doesn't
        // cause a one-frame composite stall on slower phones. Cleared
        // after the lift completes (below) so we don't leak the layer.
        tl.add(() => {
          userEl.style.willChange = 'transform, opacity'
        }, igniteEnd + 1.3)

        // PHASE 0: face the camera, still in perspective. 0.25s — feels
        // snappy on mobile; the user's eye is already on the ticket so
        // the prep beat doesn't need to linger.
        tl.to(userEl, {
          rotationX: -62,
          duration: 0.25,
          ease: 'power1.out'
        }, igniteEnd + 1.35)
        // YOU chevron fades out so it doesn't ride along with the lift.
        if (youChevronRef.current) {
          tl.to(youChevronRef.current,
            { opacity: 0, duration: 0.25, ease: 'power2.out' },
            igniteEnd + 1.35
          )
        }

        // DETACH + LIFT START at the SAME timeline moment (igniteEnd +
        // 1.6, immediately after counter-tilt finishes). Previously
        // there were two 50ms gaps (counter-tilt → detach, then
        // detach → lift) that read as a stutter where the ticket
        // briefly hung still. Eliminating the gaps makes the gesture
        // feel like one continuous motion.
        //
        // Visual-continuity trick: capture the ticket's bounding rect
        // BEFORE reparenting, then seed the gsap.set in the new parent
        // with offsets + scale that exactly match the previous screen
        // position. Without this, the ticket jumps from its
        // perspective-projected position (above center, shrunken by
        // the rig's perspective) to the flat-layer's geometric center
        // at scale 1 — read as a frame-1 jerk.
        //
        // Landing dimensions:
        //   - WIN: hero ticket is `goldenLandscape` rendered at width:
        //     340, height: auto → height = 340 / heroAspect. The lift's
        //     scaleX/Y is computed to produce exactly that post-rotate
        //     visual.
        //   - landingY (vertical offset): based on the FLAT-LAYER's
        //     measured height, not `window.innerHeight`. On mobile,
        //     innerHeight can shift transiently when the URL bar
        //     shows/hides; the flat-layer's bounding rect is the actual
        //     rendered viewport height + matches the CSS percentage
        //     that ResultHero's `top: 42%` resolves against.
        const LANDING_OFFSET_VH = -8   // ticket center at top: 42% of vh
        const HERO_WIDTH = 340
        const heroHeight = HERO_WIDTH / assets.heroAspect
        const scaleY = HERO_WIDTH / 180
        const scaleX = heroHeight / 80

        // The reparent + gsap.set seeding runs on the timeline at 1.6.
        // Phase 1+2 starts AT THE SAME TIME (no gap). GSAP runs
        // callbacks before tweens at the same position, so the set
        // happens first, then the tween starts from that state.
        tl.add(() => {
          if (!flatLayer) return
          const before = userEl.getBoundingClientRect()
          flatLayer.appendChild(userEl)
          const flatRect = flatLayer.getBoundingClientRect()
          // Compute landing Y from the flat-layer's ACTUAL rendered
          // height (matches CSS percentages exactly).
          const landingY = flatRect.height * (LANDING_OFFSET_VH / 100)
          // Stash the landing Y on the element so the tween below
          // reads it from the right scope. (gsap.to needs a JS value
          // at queue time; we use a forward declaration via a setter.)
          const offsetX =
            (before.left + before.width / 2) -
            (flatRect.left + flatRect.width / 2)
          const offsetY =
            (before.top + before.height / 2) -
            (flatRect.top + flatRect.height / 2)
          const scaleMatch = before.width / 80
          gsap.set(userEl, {
            x: offsetX, y: offsetY,
            rotation: 0, rotationX: 0, rotationY: 0,
            scale: scaleMatch,
            opacity: 1,
            zIndex: 20,
            transformOrigin: '50% 50%'
          })
          // Phase 1+2 tween — kicked off imperatively here so its
          // `y: landingY` reads the just-computed flat-rect height.
          // Lives on the GLOBAL gsap (not the master timeline) since
          // its target was unknown at timeline build; the master
          // timeline holds for `liftDuration` via the empty tween
          // below so subsequent timeline steps wait correctly.
          liftTween = gsap.to(userEl, {
            x: 0,
            y: landingY,
            rotation: -90,
            scaleX,
            scaleY,
            duration: 0.85,
            ease: 'power2.inOut'
          })
        }, igniteEnd + 1.6)
        // Master-timeline placeholder so the subsequent steps in the
        // timeline wait the lift's duration before firing.
        tl.to({}, { duration: 0.85 }, igniteEnd + 1.6)

        // Single light particle puff at the apex. Previously fired
        // legendaryBurst (280 particles) + legendaryFollowup (80) =
        // 360 particles; that was over-the-top and the legendary art
        // is reserved for the NFT screen's high-value flips. A single
        // gold dustBurst (80 particles) is enough exclamation for the
        // landing without taxing mobile.
        tl.add(() => {
          if (!particlesRef.current || !rootRef.current) return
          const r = userEl.getBoundingClientRect()
          const rootR = rootRef.current.getBoundingClientRect()
          const x = r.left + r.width / 2 - rootR.left
          const y = r.top + r.height / 2 - rootR.top
          particlesRef.current.dustBurst(x, y, [255, 215, 110])
        }, igniteEnd + 2.35)

        // Free the GPU layer once the ticket has settled.
        tl.add(() => {
          userEl.style.willChange = 'auto'
        }, igniteEnd + 2.7)
      }

      // Hand off to ResultHero. The lifted ticket stays at its landing
      // position (gold landscape, hero size). ResultHero renders its
      // hero ticket at the same screen position starting in its gold
      // state, then flips to reveal the "you won" winning ticket art.
      tl.add(() => onComplete(), igniteEnd + 2.7)
    } else {
      // Unified LOSS path. The camera scrolls BACK from the band to the
      // user, traveling through the procession. The scroll LENGTH
      // conveys a visual sense of "you were back this far" without
      // claiming a specific count — the counter has been removed
      // because the underlying ticketDistance is currently simulated
      // (see src/draw/ticketDistance.ts).
      //
      // Scroll duration scales with the lane distance the camera
      // covers, clamped so small simulated distances feel snappy
      // (~0.8s) and huge simulated distances stay cinematic without
      // dragging (~3.5s max).
      const userLossTicket = tickets.find(t => t.kind === 'user')
      const userEl = userLossTicket ? ticketRefs.current[userLossTicket.id] : null
      const scrollDistance = Math.abs(cameraAtUser - cameraAtBand)
      const scrollDur = Math.max(0.8, Math.min(3.5, scrollDistance / 1500))

      // Camera scrolls back through the procession to the user's
      // position. Power2.out — rapid start, soft landing on the user.
      tl.to(cameraRef.current,
        { y: cameraAtUser, duration: scrollDur, ease: 'power2.out' },
        igniteEnd + 0.45
      )
      // Spotlight returns just before the camera settles on the user
      // — refocuses attention from "the long road I just traveled"
      // back to "this is your ticket". Fades up to land at the same
      // moment as the camera, with the user dead-center in the cone.
      if (spotlightRef.current) {
        tl.to(spotlightRef.current,
          { opacity: 1, duration: 0.5, ease: 'power2.out' },
          igniteEnd + 0.45 + scrollDur - 0.25
        )
      }

      // ── Loss detach + lift ───────────────────────────────────────
      //
      // Same shape as the win lift, with three loss-specific tweaks:
      //   - Lands at top: 50% (loss hero CSS), so LANDING_OFFSET_VH = 0.
      //   - Final rotation is -93° = -90° (portrait → landscape) plus
      //     the hero's -3° "spent" tilt.
      //   - Scale derives from `assets.lossAspect` (red ticket's
      //     measured aspect), NOT `heroAspect` (which is gold's). The
      //     loss hero renders `ticketLandscape`, so its visible height
      //     uses the red art's intrinsic aspect — not gold's.
      //   - Spent filter (saturate + brightness + drop-shadow) is
      //     applied on the OUTER ticket div (matches the loss hero's
      //     `.draw-result.is-loss .draw-result-ticket` filter target).
      //
      // Counter-tilt → detach + lift start at the SAME timeline moment
      // (no 50ms gaps that read as stutter).
      if (userEl && rootRef.current) {
        const flatLayer = rootRef.current.querySelector<HTMLDivElement>('.draw-flat-layer')
        const detachStart = igniteEnd + 0.45 + scrollDur + 0.35

        // Pre-warm GPU layer.
        tl.add(() => {
          userEl.style.willChange = 'transform, opacity, filter'
        }, detachStart - 0.05)

        // PHASE 0: counter-tilt (cancel the perspective rig's +62°).
        tl.to(userEl, {
          rotationX: -62,
          duration: 0.25,
          ease: 'power1.out'
        }, detachStart)

        // YOU chevron fades out so it doesn't ride along.
        if (youChevronRef.current) {
          tl.to(youChevronRef.current,
            { opacity: 0, duration: 0.25, ease: 'power2.out' },
            detachStart
          )
        }
        // Spotlight fades out as the lift starts.
        if (spotlightRef.current) {
          tl.to(spotlightRef.current,
            { opacity: 0, duration: 0.35, ease: 'power2.in' },
            detachStart + 0.1
          )
        }

        // Loss-specific scale derived from `lossAspect`.
        const HERO_WIDTH = 340
        const heroHeight = HERO_WIDTH / assets.lossAspect
        const scaleY = HERO_WIDTH / 180
        const scaleX = heroHeight / 80

        // DETACH + LIFT at the SAME timeline moment (no gap → no
        // stutter). Lift's landingY is computed from the flat-layer's
        // actual rendered height, matching the CSS percentage that
        // ResultHero's `top: 50%` resolves against.
        tl.add(() => {
          if (!flatLayer) return
          const before = userEl.getBoundingClientRect()
          flatLayer.appendChild(userEl)
          const flatRect = flatLayer.getBoundingClientRect()
          // Loss hero is `top: 50%` → landing Y is 0 from flat-layer
          // center.
          const landingY = 0
          const offsetX =
            (before.left + before.width / 2) -
            (flatRect.left + flatRect.width / 2)
          const offsetY =
            (before.top + before.height / 2) -
            (flatRect.top + flatRect.height / 2)
          const scaleMatch = before.width / 80
          gsap.set(userEl, {
            x: offsetX, y: offsetY,
            rotation: 0, rotationX: 0, rotationY: 0,
            scale: scaleMatch,
            opacity: 1,
            zIndex: 20,
            transformOrigin: '50% 50%'
          })
          // Phase 1+2 — kicked off here so it reads the just-measured
          // flat-rect height for landingY. Filter applied on the
          // OUTER div matches the hero's filter target (drop-shadow
          // + saturate + brightness) for a continuous compositing
          // pipeline at the swap.
          liftTween = gsap.to(userEl, {
            x: 0,
            y: landingY,
            rotation: -90 - 3,
            scaleX,
            scaleY,
            filter: 'drop-shadow(0 12px 22px rgba(0, 0, 0, 0.45)) saturate(0.78) brightness(0.88)',
            duration: 0.85,
            ease: 'power2.inOut'
          })
        }, detachStart + 0.3)
        // Master-timeline placeholder so subsequent steps wait for the
        // lift to complete.
        tl.to({}, { duration: 0.85 }, detachStart + 0.3)

        // Free GPU layer once settled.
        tl.add(() => {
          userEl.style.willChange = 'auto'
        }, detachStart + 1.2)
      }

      // Hand off to ResultHero. The lifted loss ticket sits at the
      // exact pixel position + orientation + filter as the loss hero
      // ticket → continuous visual handoff (same as win).
      tl.add(() => onComplete(), igniteEnd + 0.45 + scrollDur + 0.35 + 1.2)
    }

    return () => { tl.kill(); liftTween?.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, outcome, winnerCount])

  // User ticket (used for positioning the YOU marker overlay).
  const userTicket = useMemo(
    () => tickets.find(t => t.kind === 'user' || t.kind === 'user-winner'),
    [tickets]
  )

  return (
    <div className="draw-lane-stage" ref={rootRef}>
      <div className="draw-pattern-bg" aria-hidden="true" />
      <div className="draw-pattern-parallax" aria-hidden="true" />

      {/* Particle layer — sits above the perspective scene so gold
          bursts paint over the tilted tickets without inheriting the
          rotateX(62deg) skew. */}
      <ParticleCanvas ref={particlesRef} />

      <div className="draw-lane-stage-inner">
        <div className="draw-lane-camera" ref={cameraRef}>
          {/* Middle-stretch "ghost procession" — three tile-bg divs
              (one per lane) that render the long middle zone as a
              repeating background image instead of hundreds of real
              DOM tickets. Only rendered when there's a meaningful gap
              between dense-back and dense-user zones (i.e., lose-near
              and lose-far paths; win has no tile). */}
          {middleTile && [0 as const, 1 as const, 2 as const].map((lane) => {
            // Middle lane brick-staggered by -ROW_SPACING_HALF (same as
            // real tickets). Shifting the div by -100 in lane-Y keeps
            // the tile-center rhythm identical to real middle-lane
            // ticket positions.
            const stagger = lane === 1 ? -ROW_SPACING_HALF : 0
            const topEdgeY = middleTile.topEdgeY + stagger
            const bottomEdgeY = middleTile.bottomEdgeY + stagger
            return (
              <div
                key={`tile-${lane}`}
                className="draw-lane-tile-bg"
                aria-hidden="true"
                style={{
                  // translate(0, topEdgeY) places the div's CSS top
                  // edge at lane-Y = topEdgeY (deepest end of tile).
                  // Height extends "down" in CSS = toward less-negative
                  // lane-Y = toward the band.
                  transform: `translate(${LANE_X[lane]}px, ${topEdgeY}px)`,
                  height: `${bottomEdgeY - topEdgeY}px`,
                  backgroundImage: `url(${assets.ticketPortrait})`
                }}
              />
            )
          })}
          {tickets.map((t) => (
            <TicketEl
              key={t.id}
              ticket={t}
              assets={assets}
              registerRef={registerTicketRef}
            />
          ))}
          {/* Cut-line — sits inside the camera so it scrolls along with
              the world. Positioned via GSAP transform. */}
          <div className="draw-cutline" ref={cutlineRef} aria-hidden="true" />
          {/* YOU marker — absolutely positioned at the user's lane position
              so it scrolls/scales with the user's ticket. Display-name
              chevron only; spotlight (below) carries the visual focus. */}
          {userTicket && (
            <UserMarker
              ticket={userTicket}
              displayName={displayName}
              chevronRef={youChevronRef}
            />
          )}
        </div>
      </div>

      {/* Spotlight overlay — sits OUTSIDE the perspective rig, so it's
          screen-fixed. Cone of light centered on screen middle (which
          is where the user's ticket is during the opening close-up).
          Fades in for the "focus on you" beat, fades out before the
          cut-line descends. */}
      <div className="draw-spotlight" ref={spotlightRef} aria-hidden="true" />

      {/* Flat-2D layer — the win lift reparents the user ticket here
          at the end of Phase 0 so its subsequent translate+rotate+scale
          happens in plain screen space (no perspective skew). The lane
          ticket lives here through to the moment ResultHero takes over.
          Empty in lose paths. */}
      <div className="draw-flat-layer" aria-hidden="true" />

      {/* The "X tickets behind" counter that used to live here has been
          removed — the underlying ticketDistance is webview-simulated
          (see src/draw/ticketDistance.ts), so we shouldn't surface a
          fake number to the user. The camera's scroll-back length is
          the visual cue for "how far you were". When chain support
          lands and ticketDistance is authoritative, restore the
          counter from git history. */}

      {/* Single cinematic-text overlay — fires once at the cut-line
          lock moment. The "draw" beat. Everything else is communicated
          visually (YOU marker, gold cascade, cut-line bloom). */}
      <div className="draw-cinematic-text" ref={cinematicTextRef} aria-hidden="true">
        drawing
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

interface TicketElProps {
  ticket: LaneTicket
  assets: DrawAssets
  /** Stable callback (useCallback in parent) — receives the ticket id
   *  + element so the parent can route into its single ref registry
   *  without breaking memoization. */
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

/** Memoized so a parent re-render (e.g. setFarCounterValue ticking
 *  during lose-far scroll) does NOT re-render every ticket. Without
 *  memo, React would recompute the className string on every parent
 *  render, stripping out any imperatively-added classes like `is-gold`
 *  that the GSAP timeline added via classList.add. That regression is
 *  exactly the "gold ticket popping under red" bug — re-render
 *  overwrites the className back to "draw-lane-ticket is-winner …"
 *  with no is-gold, so display:none re-applies to the gold layer and
 *  the red comes back. */
const TicketEl = memo(function TicketEl({ ticket, assets, registerRef }: TicketElProps) {
  const { kind, hash, position } = ticket
  const isUserish = kind === 'user' || kind === 'user-winner'
  const isWinner = kind === 'winner' || kind === 'user-winner'
  // No atmospheric desaturation here — only the user's own ticket gets
  // desaturated, and only on the loss settle (driven from the timeline
  // below). Every other ticket renders at full saturation regardless of
  // depth. Cheaper on mobile too (no per-ticket inline filter).
  // Tiny rotation jitter per ticket so the procession doesn't read as a
  // sterile grid. Seed from id chars.
  const jitter = ((hash.charCodeAt(0) || 0) % 5 - 2) * 0.5
  return (
    <div
      ref={(el) => registerRef(ticket.id, el)}
      className={[
        'draw-lane-ticket',
        isUserish ? 'is-user' : '',
        isWinner ? 'is-winner' : '',
        kind === 'user-winner' ? 'is-user-winner' : ''
      ].filter(Boolean).join(' ')}
      style={{
        transform: `translate(${LANE_X[position.lane]}px, ${position.y}px) rotateZ(${jitter}deg)`
      }}
    >
      <img
        className="draw-lane-ticket-bg"
        src={assets.ticketPortrait}
        alt=""
        draggable={false}
      />
      <img
        className="draw-lane-ticket-gold"
        src={assets.goldenPortrait}
        alt=""
        draggable={false}
      />
      <div className="draw-lane-ticket-code">
        {formatTicketShort(hash)}
      </div>
    </div>
  )
})

interface UserMarkerProps {
  ticket: LaneTicket
  displayName?: string
  chevronRef: RefObject<HTMLDivElement>
}

function UserMarker({ ticket, displayName, chevronRef }: UserMarkerProps) {
  return (
    <div
      className="draw-you-marker"
      style={{
        transform: `translate(${LANE_X[ticket.position.lane]}px, ${ticket.position.y}px)`
      }}
      aria-hidden="true"
    >
      <div className="draw-you-chevron" ref={chevronRef}>
        {displayName || 'YOU'} <span className="draw-you-chevron-arrow">▼</span>
      </div>
    </div>
  )
}
