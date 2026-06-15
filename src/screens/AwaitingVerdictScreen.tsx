// AwaitingVerdictScreen — the calm "tallying your results…" beat shown after
// the collectibles reveal when the game outcome hasn't resolved yet.
//
// Collectibles arrive quickly now, so finishing the reveal no longer means
// "we've given up waiting" — just "the verdict is still landing". App routes
// here when the reveal finishes with no outcome, then:
//   - routes to the verdict (results) the instant the outcome arrives, or
//   - auto-falls-back to the Pocket handoff after a long wait (App owns that
//     timer), or
//   - the user can leave early via the "Check your Pocket" escape that fades
//     in after a short delay, so they're never trapped staring at a spinner.

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'

// How long before the manual "Check your Pocket" escape appears. Short enough
// that an impatient user isn't trapped, long enough that the verdict usually
// lands first and they never see it.
const SKIP_AFTER_MS = 12_000

interface AwaitingVerdictScreenProps {
  /** Leave for the Pocket handoff (manual escape). */
  onSkip: () => void
}

export default function AwaitingVerdictScreen({ onSkip }: AwaitingVerdictScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [showSkip, setShowSkip] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setShowSkip(true), SKIP_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [])

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
    <div className="await-screen" ref={rootRef} aria-live="polite">
      <div className="await-mark" aria-hidden="true">◌</div>
      <div className="await-headline">Tallying your results…</div>
      <div className="await-sub">This usually only takes a moment.</div>
      {showSkip && (
        <button type="button" className="await-skip" onClick={onSkip}>
          Check your Pocket
        </button>
      )}
    </div>
  )
}
