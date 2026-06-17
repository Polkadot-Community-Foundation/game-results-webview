import { gsap } from 'gsap'
import { EASE } from './easings'
import { sfx } from '../audio/engine'
import type { OrbApi } from '../reveal3d/OrbScene'
import type { ParticleCanvasApi } from '../components/ParticleCanvas'
import type { Tint } from '../particles/emitters'

// Final rendered size of the slot badge (matches .slot-badge in styles.css).
const SLOT_BADGE_SIZE = 110

interface StoreOptions {
  // Reveal element (today: OrbScene; previously: Card). Only `root` and
  // `center` are consumed, so any object satisfying that shape works.
  cardApi: OrbApi
  flyBadgeEl: HTMLImageElement
  fromRect: { width: number; height: number; left: number; top: number }
  slotCenter: { x: number; y: number }
  slotEl: HTMLElement | null
  particles: ParticleCanvasApi
  stageRect: DOMRect
  tint?: Tint
}

// Store animation: the badge lifts off the card, arcs to its slot, and lands
// at exactly the slot-badge's size/position so there's no teleport/pop when
// React materialises the real <img> in the slot.
export function cardStore({
  cardApi,
  flyBadgeEl,
  fromRect,
  slotCenter,
  slotEl,
  particles,
  stageRect,
  tint = [120, 90, 180]
}: StoreOptions): gsap.core.Timeline {
  const root = cardApi.root()
  const tl = gsap.timeline()

  // Start the fly-badge sized exactly like the on-card badge.
  const W = fromRect.width
  flyBadgeEl.style.width = `${W}px`
  flyBadgeEl.style.height = `${W}px`

  // Frame-relative positions (top-left of the fly-badge so its visual
  // center coincides with the source/destination centers, given
  // `transform-origin: center`).
  const startX = fromRect.left + fromRect.width / 2 - stageRect.left - W / 2
  const startY = fromRect.top + fromRect.height / 2 - stageRect.top - W / 2
  const endX = slotCenter.x - stageRect.left - W / 2
  const endY = slotCenter.y - stageRect.top - W / 2
  const endScale = SLOT_BADGE_SIZE / W

  gsap.set(flyBadgeEl, { x: startX, y: startY, scale: 1, opacity: 1 })

  // Badge whoosh fires the moment the arc starts.
  sfx.play('badge-fly')

  // Arc: rise to a peak between the two points, then descend to the slot.
  const peakX = (startX + endX) / 2
  const peakY = Math.min(startY, endY) - 60
  const midScale = (1 + endScale) / 2

  const trailTint: Tint = [255, 230, 180]

  tl.to(flyBadgeEl, {
    x: peakX,
    y: peakY,
    scale: midScale,
    duration: 0.32,
    ease: 'power2.out',
    onUpdate: () => {
      const r = flyBadgeEl.getBoundingClientRect()
      particles.badgeTrail(
        r.left + r.width / 2 - stageRect.left,
        r.top + r.height / 2 - stageRect.top,
        trailTint
      )
    }
  }, 0)

  tl.to(flyBadgeEl, {
    x: endX,
    y: endY,
    scale: endScale,
    duration: 0.32,
    ease: 'power2.in',
    onUpdate: () => {
      const r = flyBadgeEl.getBoundingClientRect()
      particles.badgeTrail(
        r.left + r.width / 2 - stageRect.left,
        r.top + r.height / 2 - stageRect.top,
        trailTint
      )
    }
  })

  // Slot pop — badge clicks into place. slotEl may be null (the slot <div>
  // hasn't mounted, or getSlotEl was out of range): gsap throws on a null
  // target ("null is not an object (evaluating 't._gsap')" on iOS WebKit),
  // which would bubble straight to the render ErrorBoundary and black-screen
  // the whole results flow. Guard it — the badge-land SFX still fires.
  tl.call(() => sfx.play('badge-land'), undefined, '-=0.08')
  if (slotEl) {
    tl.to(slotEl, {
      scale: 1.25,
      duration: 0.1,
      ease: 'power2.out'
    }, '-=0.08')
    tl.to(slotEl, {
      scale: 1,
      duration: 0.34,
      ease: EASE.settle
    })
  }

  // Card dissolves in parallel: fade + dust + slight descent. `root`
  // (cardApi.root()) is typed nullable for the same reason — skip the tween
  // rather than hand gsap a null target.
  if (root) {
    tl.to(root, {
      opacity: 0,
      y: 14,
      scale: 0.96,
      duration: 0.5,
      ease: 'power2.in',
      overwrite: 'auto'
    }, 0)
  }

  tl.call(() => {
    const { x, y } = cardApi.center()
    particles.dustBurst(x - stageRect.left, y - stageRect.top, tint)
    sfx.play('card-dissolve')
  }, undefined, 0.08)

  return tl
}
