// NoAttestationsScreen — shown when the reveal settles with ZERO attestations.
//
// Attestations are other players/the system vouching that you're a real,
// unique human, so getting none is a definitive fail (you can't pass with
// zero). Rather than route through the verdict / Pocket handoff, App sends a
// true skunk straight here. Terminal: "Got it" fires flow.complete via onDone.

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'

interface NoAttestationsScreenProps {
  /** Dismiss → App fires flow.complete so native can tear down the webview. */
  onDone: () => void
}

export default function NoAttestationsScreen({ onDone }: NoAttestationsScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (prefersReducedMotion()) {
      gsap.set(root, { opacity: 1, y: 0 })
      return
    }
    gsap.fromTo(root,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
    )
  }, [])

  return (
    <div className="noattest-screen" ref={rootRef} aria-live="polite">
      <div className="noattest-mark" aria-hidden="true">◌</div>
      <h1 className="noattest-headline">
        Nobody thought you were human enough this time.
      </h1>
      <p className="noattest-sub">Try again next week!</p>
      <button type="button" className="noattest-cta" onClick={onDone}>
        Got it
      </button>
    </div>
  )
}
