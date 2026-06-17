// ChestScreen — the pre-reveal beat. A living treasure chest that sets
// context + stakes before the collectibles shelf and gives the slow
// pushAttestation stream (and the IPFS image prefetch) a little extra time
// before the shelf takes over.
//
// It is a brief, fixed beat (CHEST_DWELL_MS) — it deliberately does NOT
// count or gate on how many collectibles have streamed in; the reveal's own
// escape-hatch covers anything still in flight. The chest rattles like
// something is trapped inside, then becomes tappable.
//
// Art: five transparent WebP layers sliced from the green-chroma sheet by
// scripts/preprocess-chest.mjs (base / treasure / lid / lock / sparkles).
// On open: lock pops, lid lifts, treasure rises + glows, sparkles burst,
// then the screen fades into the shelf.

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { sendFlowEvent } from '../bridge/send'
import { prefersReducedMotion } from '../anim/easings'

// Short, fixed dwell — a couple of seconds of "alive" chest, no more.
const CHEST_DWELL_MS = 2000

interface ChestScreenProps {
  onOpen: () => void
}

export default function ChestScreen({ onOpen }: ChestScreenProps) {
  const [openable, setOpenable] = useState(false)
  const [opening, setOpening] = useState(false)
  const reduced = prefersReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const chestRef = useRef<HTMLButtonElement>(null)
  const lidRef = useRef<HTMLImageElement>(null)
  const treasureRef = useRef<HTMLImageElement>(null)
  const lockRef = useRef<HTMLImageElement>(null)
  const sparklesRef = useRef<HTMLImageElement>(null)
  const rattleRef = useRef<gsap.core.Tween | null>(null)
  const lidJiggleRef = useRef<gsap.core.Tween | null>(null)

  // Securing gate: a short fixed timer, independent of the stream.
  useEffect(() => {
    const t = window.setTimeout(() => setOpenable(true), CHEST_DWELL_MS)
    return () => window.clearTimeout(t)
  }, [])

  // Entrance + a "something's trapped inside" rattle.
  useEffect(() => {
    const chest = chestRef.current
    if (!chest) return
    if (reduced) {
      gsap.set(chest, { opacity: 1, scale: 1, x: 0, y: 0, rotation: 0 })
      if (lidRef.current) gsap.set(lidRef.current, { x: 0, y: 0, rotation: 0 })
      return
    }
    const tl = gsap.timeline()
    tl.fromTo(chest,
      { opacity: 0, scale: 0.82, y: 18 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.5)' }
    )
    // Bursts of jittery shaking — the contents nudging to get out.
    const rattle = gsap.to(chest, {
      keyframes: {
        x: [0, -1.6, 2, -2, 1.6, -1.3, 1, -0.6, 0],
        y: [0, 1, -1, 0.7, -0.7, 1, -0.4, 0.3, 0],
        rotation: [0, -0.8, 0.9, -0.75, 0.6, -0.45, 0.35, -0.2, 0],
      },
      duration: 0.5,
      repeat: -1,
      repeatDelay: 0.6,
      ease: 'none',
      delay: 0.6,
      transformOrigin: '50% 80%',
    })
    rattleRef.current = rattle
    // The lid lifts/clacks on its own faster, out-of-phase cadence (and
    // pivots at its hinge) so it reads as the contents knocking it open —
    // not the whole chest swaying as one rigid block. It layers on top of
    // the body rattle since the lid is a child of the chest. The clasp is
    // fixed to the lid, so the lock rides the SAME tween (moving with the
    // lid, not the body).
    let lidJiggle: gsap.core.Tween | undefined
    if (lidRef.current && lockRef.current) {
      lidJiggle = gsap.to([lidRef.current, lockRef.current], {
        keyframes: {
          y: [0, -2, 0.6, -1.3, 0.3, 0],
          rotation: [0, 1.1, -0.4, 0.7, -0.2, 0],
        },
        duration: 0.34,
        repeat: -1,
        repeatDelay: 0.42,
        ease: 'none',
        delay: 0.95,
        transformOrigin: '50% 95%',
      })
      lidJiggleRef.current = lidJiggle
    }
    return () => { tl.kill(); rattle.kill(); lidJiggle?.kill() }
  }, [reduced])

  function handleOpen(): void {
    if (!openable || opening) return
    setOpening(true)
    rattleRef.current?.kill()
    lidJiggleRef.current?.kill()
    sendFlowEvent({ type: 'flow.pack_opened' })
    if (reduced) { onOpen(); return }
    const tl = gsap.timeline({ onComplete: onOpen })
    // Settle the rattle, then a tiny anticipation dip.
    if (chestRef.current) tl.to(chestRef.current, { x: 0, y: 0, rotation: 0, scale: 0.95, duration: 0.12, ease: 'power2.in' })
    // Lock pops off (reset the jiggle's hinge pivot so it flings from center).
    if (lockRef.current) tl.to(lockRef.current, { y: 34, rotation: 38, opacity: 0, transformOrigin: '50% 50%', duration: 0.28, ease: 'power2.in' }, '<')
    // Lid lifts up, tilts back, fades.
    if (lidRef.current) tl.to(lidRef.current, { yPercent: -46, rotation: -10, scale: 1.04, opacity: 0, duration: 0.42, ease: 'power2.in' }, '-=0.12')
    // Treasure rises + scales as the lid clears it.
    if (treasureRef.current) tl.to(treasureRef.current, { yPercent: -20, scale: 1.16, duration: 0.5, ease: 'back.out(1.8)' }, '-=0.30')
    // Glow burst.
    if (rootRef.current) tl.to(rootRef.current, { '--brim': 1, duration: 0.3 }, '<')
    // Sparkle burst.
    if (sparklesRef.current) tl.to(sparklesRef.current, { scale: 1.5, opacity: 0, duration: 0.55, ease: 'power2.out' }, '-=0.45')
    // Whole screen fades into the shelf (continuity handoff).
    if (rootRef.current) tl.to(rootRef.current, { opacity: 0, duration: 0.32, ease: 'power2.in' }, '-=0.08')
  }

  return (
    <div className="chest-screen" ref={rootRef}>
      <div className="chest-pattern-bg" aria-hidden="true" />

      <header className="chest-header">
        {/* Designer-demo headline (the old "Game complete" eyebrow folded into
            the accented first phrase). */}
        <h1 className="chest-title">
          <span className="chest-title-accent">Game complete.</span><br />
          Claim your prizes.
        </h1>
      </header>

      <button
        type="button"
        className="chest"
        ref={chestRef}
        onClick={handleOpen}
        disabled={!openable}
        data-openable={openable ? 'true' : 'false'}
        aria-label={openable ? 'Tap to open your treasure chest' : 'Securing your collectibles'}
      >
        <span className="chest-glow" aria-hidden="true" />
        <img className="chest-layer chest-treasure" ref={treasureRef} src="./assets/chest/treasure.webp" alt="" draggable={false} />
        <img className="chest-layer chest-base" src="./assets/chest/base.webp" alt="" draggable={false} />
        <img className="chest-layer chest-lid" ref={lidRef} src="./assets/chest/lid.webp" alt="" draggable={false} />
        <img className="chest-layer chest-lock" ref={lockRef} src="./assets/chest/lock.webp" alt="" draggable={false} />
        <img className="chest-layer chest-sparkles" ref={sparklesRef} src="./assets/chest/sparkles.webp" alt="" draggable={false} />
      </button>

      {/* What's inside, grouped by who gets it — "Everyone" (collectables) and
          "Members only" (membership + prize draw). Icons use this repo's
          assets. */}
      <div className="chest-tiers" aria-hidden="true">
        <section className="chest-tier">
          {/* No header on this tier; the empty head keeps the icon row aligned
              with the "Members only" card. */}
          <span className="chest-tier-head" aria-hidden="true">{' '}</span>
          <div className="chest-tier-items">
            <div className="chest-tier-item">
              <span className="chest-tier-icon chest-tier-icon--card">
                <img src="./assets/collectible-cassette.webp" alt="" draggable={false} />
              </span>
              <span className="chest-tier-label">Collectibles</span>
            </div>
          </div>
        </section>
        <section className="chest-tier chest-tier--locked">
          <span className="chest-tier-head">Members only</span>
          <div className="chest-tier-items">
            <div className="chest-tier-item">
              <span className="chest-tier-icon chest-tier-icon--card">
                <img src="./assets/membership-card.webp" alt="" draggable={false} />
              </span>
              <span className="chest-tier-label">Membership</span>
            </div>
            <div className="chest-tier-item">
              <span className="chest-tier-icon">
                <img src="./assets/golden_ticket.webp" alt="" draggable={false} />
              </span>
              <span className="chest-tier-label">Prize draw</span>
            </div>
          </div>
          {/* Diagonal lock ribbon (top-left → bottom-right) over the greyed
              members rewards. */}
          <span className="chest-tier-lock-banner">Play to unlock</span>
        </section>
      </div>

      {/* Bottom CTA. Disabled with a spinner + "Securing…" until the chest is
          ready (openable), then becomes the "Claim your prizes" action. */}
      <button
        type="button"
        className="chest-claim-cta cta-primary"
        onClick={handleOpen}
        disabled={!openable}
        data-ready={openable ? 'true' : 'false'}
      >
        {openable ? (
          'Open the chest'
        ) : (
          <>
            <span className="chest-claim-spinner" aria-hidden="true" />
            Collecting…
          </>
        )}
      </button>
    </div>
  )
}
