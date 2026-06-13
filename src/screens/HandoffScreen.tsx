// HandoffScreen — shown when the reveal finishes but the game outcome never
// resolved in the foreground (the attestation stream went quiet without
// crossing the passing threshold, and no setGameOutcome arrived).
//
// We deliberately do NOT declare failure here — a late-but-passing player
// and a true failer are indistinguishable at this point — so we hand off to
// the user's Pocket, where the collectibles land once the chain settles.
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
      <h1 className="handoff-headline">Still rolling in.</h1>
      <p className="handoff-sub">
        Your collectibles are still being secured. They'll show up in your
        Pocket shortly.
      </p>
      <button type="button" className="handoff-cta" onClick={onDone}>
        Got it
      </button>
    </div>
  )
}
