// HandoffScreen — the long-wait fallback when the game outcome never resolves.
// Reached only after the awaiting-verdict screen has waited a long time with no
// setGameOutcome (collectibles arrive fast now, so this is genuinely "we still
// can't confirm your result", not "collectibles still streaming").
//
// We deliberately do NOT declare failure here — a late-but-passing player and a
// true failer are indistinguishable at this point — so we hand off to the
// user's Pocket, where the result + collectibles land once the chain settles.
// Terminal screen: its button calls onDone (App fires flow.complete and
// latches the dismissal so a late outcome can't route the user back).

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'

interface HandoffScreenProps {
  /** Called when the user dismisses the handoff. App fires flow.complete
   *  and marks the handoff done so a late outcome won't re-enter the flow. */
  onDone: () => void
}

export default function HandoffScreen({ onDone }: HandoffScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current) return
    if (prefersReducedMotion()) {
      gsap.set(rootRef.current, { opacity: 1, y: 0 })
      return
    }
    gsap.fromTo(rootRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
    )
  }, [])

  return (
    <div className="handoff-screen" ref={rootRef}>
      <div className="handoff-mark" aria-hidden="true">✦</div>
      <h1 className="handoff-headline">Still finishing up.</h1>
      <p className="handoff-sub">
        We're wrapping up your results. Everything will be waiting in your
        Pocket.
      </p>
      <button type="button" className="handoff-cta" onClick={onDone}>
        Got it
      </button>
    </div>
  )
}
