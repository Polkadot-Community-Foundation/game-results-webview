// DoneScreen — the explicit exit point.
//
// Single CTA fires `flow.complete` so native can dismiss the webview.
// Native may also choose to close itself based on the event; the
// button is the user-controlled fallback either way.
//
// Prize-draw winners get a euphoric send-off: a gold "Congratulations!"
// headline that pops in and keeps a gentle glow, a sparkle burst, and the
// finale sound + haptic. Everyone else gets the calm "See you next time."

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { sendFlowEvent } from '../bridge/send'
import { sfx } from '../audio/engine'
import { haptic } from '../haptics/engine'
import { prefersReducedMotion } from '../anim/easings'

interface DoneScreenProps {
  /** Optional copy below the headline (e.g., "Next game · Wednesday, 7 PM"). */
  nextGameHint?: string
  /** True when the player won the prize draw — turns the exit into a euphoric
   *  "Congratulations!" celebration. */
  won?: boolean
}

export default function DoneScreen({ nextGameHint, won }: DoneScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)
  const burstRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reduced = prefersReducedMotion()

    if (reduced) {
      gsap.set(root, { opacity: 1, y: 0 })
      if (headlineRef.current) gsap.set(headlineRef.current, { opacity: 1, scale: 1, y: 0 })
      return
    }

    const tl = gsap.timeline()
    tl.fromTo(root,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
    )

    if (won && headlineRef.current) {
      // Euphoric pop on "Congratulations!" (the ongoing gold glow is a CSS
      // animation on the headline, so GSAP drives only transform here and the
      // two never fight over `filter`), plus a sparkle burst + finale sfx/
      // haptic right as it lands.
      tl.fromTo(headlineRef.current,
        { opacity: 0, scale: 0.78, y: -10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.8)' },
        0.08
      )
      tl.add(() => {
        sfx.play('finale')
        haptic.play('finale')
        burstSparkles(burstRef.current)
      }, 0.42)
    }

    return () => { tl.kill() }
  }, [won])

  function handleDone() {
    sendFlowEvent({ type: 'flow.complete' })
  }

  return (
    <div className={`done-screen${won ? ' is-celebrate' : ''}`} ref={rootRef}>
      {/* Prize-draw winners get the rainbow burst as a full-screen backdrop. */}
      {won && <img className="done-burst-bg" src="./assets/prize-burst.webp" alt="" aria-hidden="true" />}
      {won && <div className="done-burst" ref={burstRef} aria-hidden="true" />}
      {won ? (
        // Headline + sub on a dark banner so they read over the bright burst.
        <div className="done-banner">
          <h1 className="done-headline" ref={headlineRef}>Congratulations!</h1>
          <div className="done-sub">See you next week.</div>
        </div>
      ) : (
        <h1 className="done-headline" ref={headlineRef}>See you<br />next time.</h1>
      )}
      {!won && nextGameHint && <div className="done-hint">{nextGameHint}</div>}
      <button type="button" className="done-cta cta-primary" onClick={handleDone}>
        Done
      </button>
    </div>
  )
}

/** Gold sparkle pellets radiating from the headline — same DOM-pellet pattern
 *  as the results / username celebrations. Self-removing. */
function burstSparkles(container: HTMLDivElement | null): void {
  if (!container) return
  const N = 22
  for (let i = 0; i < N; i++) {
    const dot = document.createElement('span')
    dot.className = 'done-burst-dot'
    container.appendChild(dot)
    const angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist = 80 + Math.random() * 100
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 10
    gsap.fromTo(dot,
      { x: 0, y: 0, scale: 0.4, opacity: 0 },
      {
        x: dx, y: dy, scale: 1, opacity: 1,
        duration: 0.3, ease: 'power2.out',
        onComplete: () => {
          gsap.to(dot, {
            x: dx * 1.35, y: dy * 1.35 + 48,
            opacity: 0, scale: 0.2,
            duration: 0.8, ease: 'power1.in',
            onComplete: () => dot.remove()
          })
        }
      }
    )
  }
}
