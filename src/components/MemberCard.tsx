// MemberCard — the Polkadot membership card. Renders the iridescent card
// graphic from the iOS app (public/assets/membership-card.webp) inside the
// animated card frame (smash-in + promotion glow). The holder's name lives in
// the results headline ("Welcome, …"), so the card itself is just the artwork.

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'

interface MemberCardProps {
  displayName?: string
  /** True iff this card just promoted the user to member. Drives a glow burst. */
  promoted?: boolean
}

export default function MemberCard({ promoted }: MemberCardProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    if (prefersReducedMotion()) {
      // Reduced-motion path: snap to final state. No smash, no impact
      // shake, no promotion glow pulse.
      gsap.set(root, { opacity: 1, scale: 1, y: 0, rotation: -1.2 })
      return
    }

    const tl = gsap.timeline()

    // Card smashes in from above: starts well over actual size and
    // offset upward, accelerates into the landing (power3.in reads as
    // gravity), then squashes on impact and elastic-rebounds to rest.
    // A brief screen shake fires at the landing moment for weight.
    tl.fromTo(root,
      {
        opacity: 0,
        scale: 1.8,
        y: -240,
        rotation: -8
      },
      {
        opacity: 1,
        scale: 1,
        y: 0,
        rotation: -1.2,
        duration: 0.55,
        ease: 'power3.in'
      }
    )

    // Impact squash + elastic settle.
    tl.to(root, {
      scaleX: 1.09,
      scaleY: 0.91,
      duration: 0.07,
      ease: 'power2.out'
    })
    tl.to(root, {
      scaleX: 1,
      scaleY: 1,
      duration: 0.55,
      ease: 'elastic.out(1.1, 0.45)'
    })

    // Impact shake. Scoped to the card's wrap (and the summary block
    // below it), NOT the whole .results-screen — the celebration
    // backdrop has mix-blend-mode: screen, and shaking its parent
    // forces a per-frame composite of the blend. The headline +
    // summary copy still shake together since the wrap contains them,
    // so the impact reads as "stuff bumped" without dragging the
    // burst through the work.
    tl.add(() => {
      const wrap = root.closest('.results-card-wrap') as HTMLElement | null
      const summary = root.closest('.results-screen')?.querySelector('.results-summary') as HTMLElement | null
      const targets = [wrap, summary].filter(Boolean) as HTMLElement[]
      if (targets.length === 0) return
      gsap.fromTo(targets,
        { x: 0, y: 0 },
        {
          keyframes: [
            { x: -3, y: 2, duration: 0.04 },
            { x: 4, y: -2, duration: 0.05 },
            { x: -2, y: 1, duration: 0.05 },
            { x: 1, y: 0, duration: 0.04 },
            { x: 0, y: 0, duration: 0.04 }
          ],
          ease: 'none'
        }
      )
    }, '-=0.59')

    // Promotion glow — soft pulse on the card edge.
    if (promoted) {
      tl.fromTo(root,
        { boxShadow: '0 14px 30px rgba(0,0,0,0.45)' },
        {
          boxShadow: '0 14px 60px rgba(81, 99, 245, 0.55), 0 0 0 1px rgba(255,255,255,0.85)',
          duration: 0.5,
          yoyo: true,
          repeat: 1,
          ease: 'sine.inOut'
        },
        '-=0.2'
      )
    }

    return () => { tl.kill() }
  }, [promoted])

  return (
    <div className="member-card" ref={rootRef}>
      <img className="member-card-art" src="./assets/membership-card.webp" alt="" draggable={false} />
    </div>
  )
}
