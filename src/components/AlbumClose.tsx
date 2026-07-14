// AlbumClose — the post-reveal "Added to your Pocket" album-close sequence
// (designer prototype, Figma 161:3292). It reads like closing a book around a
// vertical spine:
//
//   1. The book opens already (front cover laid out to the LEFT, the collection
//      as the RIGHT page) and EMPTY.
//   2. Each collectible flies from EXACTLY where it sat on the reveal shelf into
//      its cell on the two facing pages — a shared-element "magic move" so the
//      same assets visibly carry from the shelf into the book (continuity).
//   3. The front cover swings RIGHT over the collection (rotateY about the
//      spine), the book grows + recentres, and it settles as the closed album.
//
// The fly needs the shelf rects captured at reveal-end (`fromRects`, from
// Stage). When they're absent (e.g. a path that didn't capture), we fall back
// to the older zoom-out-from-the-collection open.
//
// The inside pages are built from the user's REAL collectibles (resolved from
// the attestation stream); the outer cover is the designer's album-cover
// collage (AlbumCover) — optimized but unchanged from the demo.

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'
import type { ShelfFlyItem } from '../anim/shelfFly'
import AlbumCover from './AlbumCover'

interface AlbumCloseProps {
  /** The user's real collectible image srcs (already resolved). */
  srcs: string[]
  /** Shelf badge rects captured at reveal-end — each collectible flies from
   *  here into its page cell. Empty → fall back to the zoom-out open. */
  fromRects?: ShelfFlyItem[]
  /** Fires when the user dismisses the closed album (Continue tap). */
  onDone: () => void
}

const PAGE_HALF = 90 // half the page width — shifts the open spread to centre
const OPEN_SCALE = 0.96 // book scale while open (the spread)
const CLOSED_SCALE = 1.4 // settled closed-book scale

// Per-badge fly tuning. Stagger so they arrive in a quick cascade rather than
// all at once; HOLD lets the assembled open book read for a beat before it
// closes. Bumped close durations give the user's requested slower close.
const FLY_DUR = 0.5
const FLY_STAGGER = 0.06
const OPEN_HOLD = 0.25

// Fallback (no shelf capture): the whole zoom-out → close normalised to this.
const CLOSE_DURATION_S = 1.5

export default function AlbumClose({ srcs, fromRects = [], onDone }: AlbumCloseProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const flyLayerRef = useRef<HTMLDivElement>(null)

  const items = srcs.filter(Boolean)
  // Each cell uses the src of the badge that actually flies into it (the
  // captured shelf rect), falling back to the resolved src when there's no
  // capture. This guarantees a cell shows the SAME image as its flyer.
  const cellSrcs = items.map((s, i) => fromRects[i]?.src ?? s)
  // Split evenly across the two facing pages (left = inside front cover,
  // right = collection page) so they read as a real album spread.
  const half = Math.ceil(items.length / 2)
  const leftItems = cellSrcs.slice(0, half)
  const rightItems = cellSrcs.slice(half)

  useEffect(() => {
    const root = rootRef.current
    const stage = stageRef.current
    const cover = coverRef.current
    const title = titleRef.current
    const cta = ctaRef.current
    const flyLayer = flyLayerRef.current
    if (!root || !stage || !cover || !title || !cta || !flyLayer) return

    if (prefersReducedMotion()) {
      // Reduced-motion path: snap straight to the settled closed album.
      gsap.set(root, { opacity: 1 })
      gsap.set(cover, { rotateY: 0 }) // closed
      gsap.set(stage, { scale: CLOSED_SCALE, x: 0 })
      gsap.set([title, cta], { opacity: 1, y: 0 })
      return // wait for the Continue tap (onDone) instead of auto-advancing
    }

    gsap.set(title, { opacity: 0, y: -12 })
    gsap.set(cta, { opacity: 0, y: 14 })

    const canFly = fromRects.length > 0 && items.length > 0

    // Adds the cover-close + grow + recentre + headline/CTA to `tl`, starting at
    // absolute time `at`. Shared shape for both the fly and the fallback tail.
    const addClose = (tl: gsap.core.Timeline, at: number) => {
      tl.to(cover, { rotateY: 0, duration: 0.9 }, at)
      tl.to(stage, { scale: CLOSED_SCALE, duration: 0.8 }, at + 0.05)
      tl.to(stage, { x: 0, duration: 0.9 }, '<')
      tl.to(title, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out' }, at + 0.55)
      tl.to(cta, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, at + 0.7)
    }

    // ── Fallback: no shelf capture → the older zoom-out-from-collection open. ──
    if (!canFly) {
      gsap.set(root, { opacity: 1 })
      gsap.set(stage, { scale: 1.9, x: 0 }) // zoomed in on the collection page
      gsap.set(cover, { rotateY: -180 }) // open
      const tl = gsap.timeline({ paused: true, defaults: { ease: 'sine.inOut' } })
      tl.to(stage, { scale: OPEN_SCALE, x: PAGE_HALF, duration: 1.6, ease: 'power2.out' }, 0)
      tl.to(cover, { rotateY: 0, duration: 1.4 }, '-=0.3')
      tl.to(stage, { scale: CLOSED_SCALE, duration: 1.1 }, '-=1.1')
      tl.to(stage, { x: 0, duration: 1.2 }, '<')
      tl.to(title, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '-=0.55')
      tl.to(cta, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '-=0.45')
      tl.duration(CLOSE_DURATION_S)
      let raf2b = 0
      const raf1b = requestAnimationFrame(() => { raf2b = requestAnimationFrame(() => tl.play(0)) })
      return () => { cancelAnimationFrame(raf1b); cancelAnimationFrame(raf2b); tl.kill() }
    }

    // ── Shared-element fly ────────────────────────────────────────────────
    // Open the book at the spread scale and measure each (empty) page cell, then
    // fly a clone of each shelf badge from its captured rect into that cell.
    gsap.set(stage, { scale: OPEN_SCALE, x: PAGE_HALF })
    gsap.set(cover, { rotateY: -180 }) // open

    const flyRect = flyLayer.getBoundingClientRect()
    const leftCells = stage.querySelectorAll<HTMLElement>('.album-cover-face--inner .album-cell')
    const rightCells = stage.querySelectorAll<HTMLElement>('.album-page-grid .album-cell')

    const flyers: { el: HTMLImageElement; cell: HTMLElement }[] = []
    for (let i = 0; i < items.length; i++) {
      const cell = i < half ? leftCells[i] : rightCells[i - half]
      if (!cell) continue
      const from = fromRects[i]
      const cr = cell.getBoundingClientRect()
      // No source rect or an unmeasurable cell → just show the cell in place.
      if (!from || cr.width === 0) { gsap.set(cell, { opacity: 1 }); continue }

      gsap.set(cell, { opacity: 0 }) // hidden until its flyer lands

      const flyer = document.createElement('img')
      flyer.src = from.src
      flyer.className = 'album-fly-badge'
      flyer.draggable = false
      // Position the flyer ON the target cell (local to the fly layer), then
      // FLIP it back to the shelf rect via transform and animate to identity.
      flyer.style.left = `${cr.left - flyRect.left}px`
      flyer.style.top = `${cr.top - flyRect.top}px`
      flyer.style.width = `${cr.width}px`
      flyer.style.height = `${cr.height}px`
      flyLayer.appendChild(flyer)
      gsap.set(flyer, {
        x: from.left - cr.left,
        y: from.top - cr.top,
        scale: from.width / cr.width,
        transformOrigin: 'top left'
      })
      flyers.push({ el: flyer, cell })
    }

    gsap.set(root, { opacity: 1 }) // reveal now that flyers sit on the shelf spots

    const tl = gsap.timeline({ paused: true, defaults: { ease: 'sine.inOut' } })
    if (flyers.length === 0) {
      // Nothing measurable to fly — reveal everything and just close.
      gsap.set([...leftCells, ...rightCells], { opacity: 1 })
      addClose(tl, 0.1)
    } else {
      flyers.forEach((f, i) => {
        tl.to(f.el, {
          x: 0, y: 0, scale: 1,
          duration: FLY_DUR,
          ease: 'power2.out',
          onComplete: () => { gsap.set(f.cell, { opacity: 1 }); f.el.remove() }
        }, i * FLY_STAGGER)
      })
      const flyEnd = (flyers.length - 1) * FLY_STAGGER + FLY_DUR
      addClose(tl, flyEnd + OPEN_HOLD)
    }

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => tl.play(0)) })

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      tl.kill()
      flyers.forEach((f) => f.el.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="album-close" ref={rootRef}>
      <h1 className="album-done-title" ref={titleRef}>
        Added to your Pocket
      </h1>
      <div className="album-stage" ref={stageRef}>
        <div className="album">
          {/* Collection page (base / right page). */}
          <div className="album-page-grid">
            <div className="album-grid">
              {rightItems.map((s, i) => (
                <img key={i} className="album-cell" src={s} alt="" draggable={false} decoding="async" />
              ))}
            </div>
          </div>
          {/* Front cover — hinged at the left spine, two-faced. */}
          <div className="album-cover" ref={coverRef}>
            <div className="album-cover-face album-cover-face--inner" aria-hidden="true">
              <div className="album-grid">
                {leftItems.map((s, i) => (
                  <img key={i} className="album-cell" src={s} alt="" draggable={false} decoding="async" />
                ))}
              </div>
            </div>
            <div className="album-cover-face album-cover-face--outer" aria-hidden="true">
              <AlbumCover />
            </div>
          </div>
        </div>
      </div>
      {/* Flat overlay for the shelf→page badge flight (clones live here). */}
      <div className="album-fly-layer" ref={flyLayerRef} aria-hidden="true" />
      <button type="button" className="album-done-cta" ref={ctaRef} onClick={onDone}>
        Continue
      </button>
    </div>
  )
}
