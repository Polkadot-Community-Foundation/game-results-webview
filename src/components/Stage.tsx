import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type RefObject
} from 'react'
import OrbScene, { type OrbApi } from '../reveal3d/OrbScene'
import SlotGrid, { type SlotGridApi } from './SlotGrid'
import ActionLabel, { type ActionMode } from './ActionButton'
import CollectAllButton from './CollectAllButton'
import ParticleCanvas, { type ParticleCanvasApi } from './ParticleCanvas'
import { subscribeAttestations } from '../bridge/attestations'
import { resolveAttestationAsset } from '../attestations/resolver'
import { revealSpawn, revealBurst, revealChargeCancel } from '../reveal3d/revealTimeline'
import { cardStore } from '../anim/cardStore'
import { sfx } from '../audio/engine'
import { haptic } from '../haptics/engine'
import { prefersReducedMotion } from '../anim/easings'
import { gsap } from 'gsap'
import type { Tint } from '../particles/emitters'

// Stage-local card data. Each card is one streamed attestation: a hash
// from native + an image URL resolved from that hash via the
// CollectableHashResolver-based logic in attestations/resolver.ts.
// `isRare` is the authoritative rarity (resolver-derived from hash
// bytes) — it drives reveal amplification (rare = ceremonial slow-mo +
// iridescence + persistent aura, see Phase 4 of the reveal3d plan).
export interface CardData {
  id: number                 // slot index, also the React key
  badgeSrc: string           // populated once the attestation resolves; '' = unloaded
  hashHex: string            // empty until the attestation push arrives
  isRare: boolean            // hash-derived rarity; drives reveal amplification
  name: string               // resolver-derived item name (no collection); '' until resolved
  collection: string         // resolver-derived collection (first filename token); '' if none
}

// Empty placeholder slot — populated when its attestation arrives.
function emptyCard(i: number): CardData {
  return {
    id: i,
    badgeSrc: '',
    hashHex: '',
    isRare: false,
    name: '',
    collection: ''
  }
}

// Beat after the last card store completes before the finale fires — lets
// the store's slotPop settle before the next moment kicks in.
const FINALE_DELAY_MS = 150

// 'viewing' is reachable only from 'done' — a tap on a stored slot brings
// up that card's face-front in the center; another tap dismisses back to
// 'done'. The cascade phase is gone; Collect-All now snap-fills directly.
type SeqPhase = 'browsing' | 'revealing' | 'done' | 'viewing'
// 'ready' is the post-entrance, pre-flip beat — only used on the FIRST
// card of the session (the user is asked to tap to open). Subsequent
// cards auto-flip inline at cardEnter onComplete and skip 'ready'.
type CardPhase = 'idle' | 'enter' | 'ready' | 'flipping' | 'revealed' | 'storing'

interface BadgeRect {
  width: number
  height: number
  left: number
  top: number
}

/** Fallback badge-rect when the orb's IPFS <img> hasn't rendered yet
 *  (e.g., reduced-motion path firing the store immediately). Sized at
 *  ~50% of the orb-scene width, centered. */
function approxOrbImageRect(orbRect: DOMRect): BadgeRect {
  const size = orbRect.width * 0.6
  return {
    width: size,
    height: size,
    left: orbRect.left + (orbRect.width - size) / 2,
    top: orbRect.top + (orbRect.height - size) / 2
  }
}

// The shelf shape is ALWAYS 10 slots — a fixed 5×2 layout that
// represents the maximum possible attestation set. Even when the user
// passed fewer than 10 attestations, the empty slots stay visible as
// placeholders for the ones they didn't earn. This reinforces "you
// could have had up to 10" without making the layout shift per game.
// Exported so App's settle gate counts on-shelf arrivals against the same
// bound the shelf renders against.
export const SHELF_SIZE = 10

interface StageProps {
  frameRef: RefObject<HTMLDivElement>
  /** True once the webview stops waiting for more cards (the outcome
   *  resolved, the stream went quiet, all 10 arrived, or the foreground
   *  cap). The finale only fires once the user has stored every arrived
   *  card AND this is true — so a still-streaming pack isn't cut short. */
  streamSettled?: boolean
  /** Called once the user dismisses the finale (Continue tap). */
  onComplete?: () => void
}

export default function Stage({ frameRef, streamSettled = false, onComplete }: StageProps) {
  // 10 placeholder cards rendered upfront — always. Each placeholder gets
  // populated in-place when its attestation arrives via
  // window.pushAttestation (see the subscriber effect below). Slots that
  // never receive a push stay as empty placeholders by design.
  const [cards, setCards] = useState<CardData[]>(() =>
    Array.from({ length: SHELF_SIZE }, (_, i) => emptyCard(i))
  )

  const [seqPhase, setSeqPhase] = useState<SeqPhase>('browsing')
  // Per-card phase while seqPhase === 'revealing'.
  const [phase, setPhase] = useState<CardPhase>('idle')
  // Slot index of the card currently being revealed (-1 while browsing).
  const [activeSlot, setActiveSlot] = useState<number>(-1)
  const [filled, setFilled] = useState<(string | null)[]>(() => Array(SHELF_SIZE).fill(null))
  const [collectAllVisible, setCollectAllVisible] = useState(false)
  // True between user tapping Collect-All and the snap-fill firing — only
  // populated when the user taps before all 10 composites have arrived.
  const [collectAllPending, setCollectAllPending] = useState(false)
  // True once the user taps Collect-All while the stream is STILL OPEN: we
  // snap-fill what's arrived and stay in 'browsing', auto-filling each later
  // arrival (see the auto-fill effect) so nothing the user earned is dropped.
  // The settle→done effect fires the finale once the stream settles. Reset on
  // reaching the finale. (Tapping Collect-All after the stream settled goes
  // straight to 'done' and never sets this.)
  const [collectAllActive, setCollectAllActive] = useState(false)
  // Slot indices whose silhouettes have glowed in as "ready to tap".
  const [readySlots, setReadySlots] = useState<Set<number>>(() => new Set())
  // Toggled true after the last card stores; drives the finale-label visibility
  // and the .slot-grid.is-finale shelf-pop class.
  const [finaleVisible, setFinaleVisible] = useState(false)
  // Continue button shows up 1.5s after the finale lands so the user
  // has a moment to read "Collection complete!" before the CTA arrives.
  const [continueVisible, setContinueVisible] = useState(false)
  // Mirrored into refs so onComplete callbacks can read latest values without
  // being recreated every state change.
  const readySlotsRef = useRef<Set<number>>(readySlots)
  const filledRef = useRef<(string | null)[]>(filled)
  // cards ref is critical for storeAll's setFilled: with streaming
  // attestations, cards updates AFTER the user has tapped Collect-All
  // (more attestations arrive during the awaitFullLoad pause). The
  // useCallback closure captures the cards snapshot at tap time; the
  // ref gives us the freshest cards when the snap-fill actually fires.
  const cardsRef = useRef<CardData[]>(cards)
  useEffect(() => { readySlotsRef.current = readySlots }, [readySlots])
  useEffect(() => { filledRef.current = filled }, [filled])
  useEffect(() => { cardsRef.current = cards }, [cards])
  // Latest arrived (resolved) count + settle flag — read inside the store
  // callbacks without re-creating them on every state change.
  const arrivedRef = useRef(0)
  useEffect(() => { arrivedRef.current = readySlots.size }, [readySlots])
  const streamSettledRef = useRef(streamSettled)
  useEffect(() => { streamSettledRef.current = streamSettled }, [streamSettled])

  const cardRefs = useRef<Record<number, OrbApi>>({})
  const slotRef = useRef<SlotGridApi>(null)
  const particleRef = useRef<ParticleCanvasApi>(null)
  const flyLayerRef = useRef<HTMLDivElement | null>(null)
  const dimRef = useRef<HTMLDivElement | null>(null)
  const flashRef = useRef<HTMLDivElement | null>(null)
  // Counter for failed composite loads. Surfaces via window.__ASSET_FAILURES__
  // so App.tsx can include it in the flow.error event fired on entering
  // 'done'. Replaces the previous per-card console.warn spam.
  const failureCountRef = useRef<number>(0)
  // Stuck-screen affordance: when readySlots stays at zero for too long
  // (typically because IPFS is down), we surface a manual Continue
  // overlay so the user isn't trapped staring at blank silhouettes.
  const [stuckOverlayVisible, setStuckOverlayVisible] = useState(false)
  // Latches true after the finale fires its sparkle + sfx + haptic the
  // FIRST time we enter 'done'. Returning to 'done' from 'viewing'
  // (after the user dismisses an inspected card) re-runs the finale
  // useEffect; the latch keeps us from re-firing the celebration burst
  // on every dismiss.
  const finaleFiredRef = useRef(false)
  // Cancels the in-flight single-card store (kills its GSAP timeline + removes
  // its fly-badge). Lets Collect-All take over mid-store WITHOUT the store's
  // onComplete later firing and resetting the sequence state out from under
  // the finale. Null when no store is in flight.
  const storeCancelRef = useRef<(() => void) | null>(null)
  // Finale timers — held in refs so they're cleared on unmount. The nested
  // Continue-button timeout previously leaked if the user left mid-celebration
  // (only the outer delay timer was cleared, and only on seqPhase change).
  const finaleTimerRef = useRef<number | null>(null)
  const continueTimerRef = useRef<number | null>(null)
  // True once the live tap-and-hold charge crosses the commit
  // threshold during the current hold. Drives the label switch
  // from "Tap and hold" to "Reveal!" — signals the user can let go.
  // Reset on pointer-up (commit OR cancel). The ref mirror lets the
  // GSAP onUpdate short-circuit without calling setState every frame.
  const [readyToReveal, setReadyToReveal] = useState(false)
  const readyToRevealRef = useRef(false)

  const revealedCount = useMemo(
    () => filled.filter(Boolean).length,
    [filled]
  )
  const current: CardData | null = activeSlot >= 0 ? cards[activeSlot]! : null

  // Build silhouettes array: a badge src for each non-revealed slot in the
  // sequence, null otherwise. Cards whose modular-item composite hasn't
  // loaded yet have badgeSrc='' — emit null for those so SlotGrid skips
  // rendering the silhouette until it's ready.
  const silhouettes = useMemo<(string | null)[]>(() => {
    const arr: (string | null)[] = Array(cards.length).fill(null)
    for (let i = 0; i < cards.length; i++) {
      if (filled[i]) continue
      const src = cards[i]?.badgeSrc
      arr[i] = src ? src : null
    }
    return arr
  }, [cards, filled])

  // Subscribe to attestation pushes from native. Each push lands at a
  // specific slot index and:
  //   1. Patches the placeholder card with the hash (badgeSrc stays
  //      empty until the resolver returns).
  //   2. Calls the asset resolver (CollectableHashResolver-based logic
  //      against the Bulletin-chain CID map). When it resolves, we
  //      capture the URL + the authoritative `isRare` flag — the hash
  //      bytes deterministically pick both the image AND its rarity,
  //      so isRare drives all reveal amplification (slow-mo, aura,
  //      etc.). `payload.highValue` from native is advisory only.
  //   3. Marks the slot ready so the silhouette becomes tappable.
  //
  // Pushes that arrived before subscription are replayed by the channel
  // in index order, so the shelf populates deterministically regardless
  // of when Stage mounts.
  useEffect(() => {
    let cancelled = false
    const off = subscribeAttestations((payload) => {
      const slotIdx = payload.index
      if (slotIdx >= SHELF_SIZE) {
        // Native pushed beyond the shelf size — log and skip so a
        // mis-sized push doesn't corrupt the layout. SHELF_SIZE is the
        // hard upper bound on slot indices.
        console.warn(`[stage] attestation index ${slotIdx} >= shelf size ${SHELF_SIZE}, dropping`)
        return
      }
      setCards((prev) => {
        const next = prev.slice()
        const existing = next[slotIdx] ?? emptyCard(slotIdx)
        next[slotIdx] = {
          ...existing,
          hashHex: payload.hash
          // badgeSrc + isRare populated below when the resolver returns
        }
        return next
      })
      resolveAttestationAsset(payload.hash)
        .then(({ url, isRare, name, collection }) => {
          if (cancelled) return
          setCards((prev) => {
            const next = prev.slice()
            const c = next[slotIdx]
            if (c) {
              next[slotIdx] = { ...c, badgeSrc: url, isRare, name, collection }
            }
            return next
          })
          setReadySlots((s) => {
            const next = new Set(s)
            next.add(slotIdx)
            return next
          })
        })
        .catch((err) => {
          // Asset resolution failed for this attestation — count it and
          // skip. The rest of the shelf still works; App.tsx will roll
          // the failure count into a single flow.error on session end.
          failureCountRef.current += 1
          ;(window as unknown as { __ASSET_FAILURES__?: number })
            .__ASSET_FAILURES__ = failureCountRef.current
          console.warn(`[stage] asset resolve failed slot=${slotIdx} total=${failureCountRef.current}`, err)
        })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Collect-all surfaces as a "skip to end" affordance once a couple of
  // cards have arrived and there's still something unstored. The total is
  // unknown upfront now, so this gates on the LIVE arrived count rather
  // than a fixed expected count.
  useEffect(() => {
    const arrived = readySlots.size
    if ((seqPhase === 'browsing' || seqPhase === 'revealing') &&
        !collectAllActive &&
        arrived >= 2 && revealedCount < arrived) {
      setCollectAllVisible(true)
    } else if (!collectAllPending) {
      setCollectAllVisible(false)
    }
  }, [seqPhase, revealedCount, readySlots.size, collectAllPending, collectAllActive])

  // Escape hatch. Surfaces a manual Continue when the user is parked on the
  // shelf with nothing to act on:
  //   (a) the stream is SETTLED but nothing ever arrived (skunk / total
  //       failure) — show it right away so the user can move on (the finale
  //       path only handles storedCount > 0), or
  //   (b) nothing has loaded yet and the stream isn't settled (slow IPFS /
  //       native) — fall back to a long timeout so the user isn't trapped.
  // When the user HAS stored cards and the stream settles, the settle→done
  // effect below fires the normal finale instead.
  const STUCK_TIMEOUT_MS = 120_000
  useEffect(() => {
    if (seqPhase !== 'browsing') { setStuckOverlayVisible(false); return }
    const storedCount = filled.reduce((n, b) => (b ? n + 1 : n), 0)
    const readyUnstored = Array.from(readySlots).some((i) => !filled[i])
    // The user can still act, or has a collection the finale will close out.
    if (readyUnstored || storedCount > 0) {
      setStuckOverlayVisible(false)
      return
    }
    // storedCount === 0 with nothing ready to reveal.
    if (streamSettled) { setStuckOverlayVisible(true); return }
    const t = window.setTimeout(() => setStuckOverlayVisible(true), STUCK_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [seqPhase, readySlots, filled, streamSettled])

  // Settle → finale. Once the stream is settled and the user has stored
  // every card that arrived, fire the finale. Covers the case where the
  // user emptied the shelf BEFORE `streamSettled` flipped (they were
  // waiting on the outcome / a quiet stream).
  useEffect(() => {
    if (seqPhase !== 'browsing') return
    if (!streamSettled) return
    const storedCount = filled.reduce((n, b) => (b ? n + 1 : n), 0)
    const readyUnstored = Array.from(readySlots).some((i) => !filled[i])
    if (readyUnstored) return
    if (storedCount > 0) {
      setCollectAllActive(false)
      setActiveSlot(-1)
      setPhase('idle')
      setSeqPhase('done')
    }
  }, [seqPhase, streamSettled, filled, readySlots])

  // Auto-collect: while Collect-All is active and the stream is still open,
  // snap-fill each newly-arrived attestation as it resolves. This is what
  // keeps "collect all" honest for a still-streaming pack — every earned
  // collectible lands on the shelf, and the settle→done effect above fires
  // the finale only once the stream settles with everything filled. (Tapping
  // Collect-All at card 4 of 10 used to jump to 'done' and silently drop
  // cards 5..10 that were still streaming in.)
  useEffect(() => {
    if (!collectAllActive) return
    setFilled((prev) => {
      let changed = false
      const next = prev.slice()
      const cs = cardsRef.current
      for (let i = 0; i < cs.length; i++) {
        const src = cs[i]?.badgeSrc
        if (src && !next[i]) { next[i] = src; changed = true }
      }
      return changed ? next : prev
    })
  }, [collectAllActive, readySlots, cards])

  function handleStuckContinue(): void {
    // User chose to bail. onComplete fires the nft_reveal_complete
    // event from the caller (NFTRevealScreen wraps Stage).
    setStuckOverlayVisible(false)
    if (onComplete) onComplete()
  }

  // Collect-All snap-fills whatever has resolved so far — the total is
  // unknown, so there's nothing to wait for. Resolves immediately.
  const awaitFullLoad = useCallback(() => Promise.resolve(), [])

  // Imperative reveal trigger — invoked when the user releases a
  // sufficiently-charged tap-and-hold (first reveal) or from spawn
  // onComplete on chained reveals. `chargeValue` (0..1) drives burst
  // intensity: chained auto-reveals pass 1.0; user-held reveals pass
  // the live charge at release.
  const performReveal = (api: OrbApi, card: CardData, chargeValue: number = 1.0) => {
    const frameEl = frameRef.current
    if (!frameEl || !particleRef.current) return
    const stageRect = frameEl.getBoundingClientRect()
    sfx.play('tap-open')
    setPhase('flipping')
    revealBurst(
      api,
      particleRef.current,
      stageRect,
      {
        isRare: card.isRare,
        reduced: prefersReducedMotion(),
        charge: chargeValue,
        env: { dimEl: dimRef.current, flashEl: flashRef.current },
      },
      () => setPhase('revealed')
    )
  }

  // ── Orb spawn → wait-for-tap-and-hold ────────────────────────────────
  // EVERY reveal requires the user's deliberate tap-and-hold gesture
  // — no auto-burst chaining. The user can always use Collect-All to
  // fast-forward the rest. This gives each reveal its own moment of
  // anticipation and respects the user's pace.
  //
  // Phase progression is DECOUPLED from the orb's visual animation.
  // R3F's reconciler mounts the orb mesh asynchronously, with timing
  // that varies between desktop and mobile browsers. The phase timer
  // below ALWAYS advances 'enter' → 'ready' after the spawn
  // duration; the visual spawn fires precisely when OrbScene's
  // onOrbReady callback runs (no polling, no race). Together this
  // makes tap-and-hold reliable on desktop AND mobile.

  // Stash the latest spawn invocation per-slot so OrbScene's
  // onOrbReady callback (declared in JSX, can't capture changing
  // closures cleanly) can trigger it without re-binding.
  const pendingSpawnRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (seqPhase !== 'revealing') return
    if (phase !== 'enter') return
    if (!current) return
    const api = cardRefs.current[current.id]
    if (!api) return

    const reduced = prefersReducedMotion()
    const SPAWN_DURATION_MS = reduced ? 0 : 600

    // 1. Phase-progression timer — fires regardless of orb-mesh state.
    const phaseTimer = window.setTimeout(() => {
      setPhase('ready')
    }, SPAWN_DURATION_MS)

    // 2. Visual spawn — runs immediately if the orb mesh is already
    //    mounted; otherwise armed for OrbScene's onOrbReady callback
    //    to call it as soon as the mesh commits to the scene.
    let visualTl: gsap.core.Timeline | null = null
    let cancelled = false

    const runVisualSpawn = (): void => {
      if (cancelled) return
      if (visualTl) return  // already ran (e.g., called twice)
      const frameEl = frameRef.current
      if (!frameEl) return
      const stageRect = frameEl.getBoundingClientRect()
      visualTl = revealSpawn(api, particleRef.current, stageRect, { reduced })
    }

    if (api.orb()) {
      // Mesh already mounted (e.g., OrbScene was reused or a
      // re-render after a prior reveal). Spawn immediately.
      runVisualSpawn()
    } else {
      // Arm — onOrbReady (passed down to OrbScene) will fire this
      // the instant R3F commits the mesh.
      pendingSpawnRef.current = runVisualSpawn
    }

    return () => {
      cancelled = true
      window.clearTimeout(phaseTimer)
      pendingSpawnRef.current = null
      visualTl?.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot, current?.id, seqPhase, phase])

  // (Old `onOpen` removed — first-reveal commit now happens via the
  // tap-and-hold charge release in tapZonePointerUp below.)

  // ── View-mode prep ────────────────────────────────────────────────────
  // When user taps a stored slot in finale, the OrbScene mounts in
  // "already revealed" mode — the orb is hidden, the IPFS image is
  // shown at full opacity + scale. No 3D animation needed.
  useLayoutEffect(() => {
    if (seqPhase !== 'viewing') return
    if (!current) return
    const api = cardRefs.current[current.id]
    if (!api) return
    const root = api.root()
    const orb = api.orb()
    const img = api.image()
    if (root) gsap.set(root, { opacity: 1, scale: 1 })
    if (orb) orb.scale.set(0, 0, 0)
    if (img) gsap.set(img, { opacity: 1, scale: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqPhase, activeSlot, current?.id])

  // ── All-done finale ───────────────────────────────────────────────────
  // After the last card stores (or store-all completes), fire a single
  // sparkle burst from the center and reveal the "Collection complete!"
  // label. Latched via finaleFiredRef so dismissing an inspected card
  // (viewing → done) doesn't re-trigger the celebration.
  useEffect(() => {
    if (seqPhase !== 'done') {
      // 'viewing' is a sibling of 'done' — keep finale visuals up while
      // a card is being inspected, only tear down when truly leaving.
      if (seqPhase !== 'viewing') setFinaleVisible(false)
      return
    }
    if (finaleFiredRef.current) return
    finaleFiredRef.current = true
    finaleTimerRef.current = window.setTimeout(() => {
      const frameEl = frameRef.current
      const particles = particleRef.current
      if (frameEl && particles) {
        const r = frameEl.getBoundingClientRect()
        particles.sparkleBurst(r.width / 2, r.height / 2)
        particles.revealStarfield()
      }
      sfx.play('finale')
      haptic.play('finale')
      setFinaleVisible(true)
      // Continue button appears 1.5s after the finale so the celebration
      // beat lands before the CTA arrives. Held in a ref (not cleared here)
      // so it survives a done→viewing→done round-trip; the unmount effect
      // below clears it.
      continueTimerRef.current = window.setTimeout(() => setContinueVisible(true), 1500)
    }, FINALE_DELAY_MS)
    return () => { if (finaleTimerRef.current) window.clearTimeout(finaleTimerRef.current) }
  }, [seqPhase, frameRef])

  // Clear finale timers on unmount (the nested Continue timeout otherwise
  // leaked when the user left mid-celebration).
  useEffect(() => () => {
    if (finaleTimerRef.current) window.clearTimeout(finaleTimerRef.current)
    if (continueTimerRef.current) window.clearTimeout(continueTimerRef.current)
  }, [])

  const onSilhouetteClick = useCallback((slotIdx: number) => {
    // While Collect-All is queued/active, don't let the user start a manual
    // reveal in parallel — it'd race the snap-fill / auto-collect.
    if (collectAllPending || collectAllActive) return
    if (seqPhase !== 'browsing') return
    if (filled[slotIdx]) return
    if (!readySlots.has(slotIdx)) return

    // First user gesture — unlocks the AudioContext + primes haptic
    // user-activation for the rest of the session. Idempotent; cheap to
    // call every tap. No haptic on the silhouette-tap itself — haptic
    // is reserved for landings + celebrations (see haptics/engine.ts).
    sfx.initFromGesture()
    haptic.initFromGesture()
    sfx.play('silhouette-tap')

    // Instant tap feedback — fire a particle pulse from the silhouette's
    // center BEFORE the state change so the tap registers visually in the
    // same frame as the click. The 0.55s cardEnter never feels like dead
    // air; the user sees their tap "land" immediately.
    if (particleRef.current && slotRef.current && frameRef.current) {
      const center = slotRef.current.getSlotCenter(slotIdx)
      if (center) {
        const r = frameRef.current.getBoundingClientRect()
        particleRef.current.silhouetteTap(center.x - r.left, center.y - r.top)
      }
    }

    setActiveSlot(slotIdx)
    setSeqPhase('revealing')
    setPhase('enter')
  }, [collectAllPending, collectAllActive, seqPhase, filled, readySlots, frameRef])

  // Commit a stored card and pick the next sequence state. Shared by the
  // store animation's onComplete AND the geometry-missing fallback in onStore
  // (so a missing slot/orb can't strand us in 'storing'). Reads the freshest
  // cards / filled / readySlots / settle via refs, so it needs no deps.
  const finishStore = useCallback((slotIdx: number, badgeSrc: string) => {
    const nextFilled = filledRef.current.slice()
    nextFilled[slotIdx] = badgeSrc
    const filledCount = nextFilled.filter(Boolean).length

    // If any OTHER silhouette is already ready (and not yet revealed), chain
    // straight into it rather than kicking the user back to browse. Lowest
    // slot-index first (deterministic, matches reading order).
    const ready = readySlotsRef.current
    const candidates: number[] = []
    for (let i = 0; i < cardsRef.current.length; i++) {
      if (i === slotIdx) continue
      if (nextFilled[i]) continue
      if (!ready.has(i)) continue
      candidates.push(i)
    }
    candidates.sort((a, b) => a - b)

    setFilled(nextFilled)
    if (candidates.length > 0) {
      setActiveSlot(candidates[0]!)
      setPhase('enter')
    } else if (streamSettledRef.current && filledCount >= arrivedRef.current) {
      // Stored every card that ARRIVED and the stream is settled → finale.
      setActiveSlot(-1)
      setPhase('idle')
      setSeqPhase('done')
    } else {
      // More may still arrive (or we're awaiting the outcome) — return to
      // browsing; the settle→done effect closes it out later.
      setActiveSlot(-1)
      setPhase('idle')
      setSeqPhase('browsing')
    }
  }, [])

  const onStore = useCallback(() => {
    if (phase !== 'revealed') return
    if (!current) return
    const api = cardRefs.current[current.id]
    if (!api) return
    const frameEl = frameRef.current
    if (!frameEl || !flyLayerRef.current || !slotRef.current || !particleRef.current) return

    const slotIdx = activeSlot
    const badgeSrc = current.badgeSrc

    sfx.play('tap-store')
    haptic.play('tap-store')
    // Stop any rare-aura loop that may be running (Phase 4 adds it for
    // rare reveals; harmless no-op until then).
    if (current.isRare) sfx.stopLoop('legendary-aura-loop')

    // Resolve ALL geometry BEFORE mutating phase or touching the DOM. The
    // source rect is the orb's IPFS image, falling back to a centered
    // approximation off the orb root if the image hasn't rendered yet. If the
    // slot center OR the source rect is unavailable, commit the store WITHOUT
    // the arc animation — never set 'storing' or append a fly-badge that we'd
    // then strand (the old order appended the badge + set 'storing' before the
    // `if (!slotCenter) return`, soft-locking the user in 'storing' forever
    // and leaking the badge; api.root()! could also throw into the boundary).
    const slotCenter = slotRef.current.getSlotCenter(slotIdx)
    const imgEl = api.image()
    const rootEl = api.root()
    const fromRect: BadgeRect | null = imgEl
      ? imgEl.getBoundingClientRect()
      : rootEl ? approxOrbImageRect(rootEl.getBoundingClientRect()) : null
    if (!slotCenter || !fromRect) {
      finishStore(slotIdx, badgeSrc)
      return
    }

    setPhase('storing')
    const stageRect = frameEl.getBoundingClientRect()

    const flyBadge = document.createElement('img')
    flyBadge.src = badgeSrc
    flyBadge.className = 'fly-badge'
    flyBadge.alt = ''
    flyBadge.draggable = false
    flyLayerRef.current.appendChild(flyBadge)

    if (current.isRare) {
      setTimeout(() => particleRef.current?.stopAmbient(), 450)
    }

    const slotEl = slotRef.current.getSlotEl(slotIdx)
    const tint: Tint = current.isRare ? [255, 140, 60] : [120, 90, 180]

    const tl = cardStore({
      cardApi: api,
      flyBadgeEl: flyBadge,
      fromRect,
      slotCenter,
      slotEl,
      particles: particleRef.current,
      stageRect,
      tint
    })
    // Let storeAll cancel this store mid-flight: kill the timeline (so its
    // onComplete never fires after we've moved to the finale) and remove the
    // fly-badge so it can't leak.
    storeCancelRef.current = () => {
      tl.kill()
      if (flyBadge.parentNode) flyBadge.parentNode.removeChild(flyBadge)
    }
    tl.eventCallback('onComplete', () => {
      storeCancelRef.current = null
      if (flyBadge.parentNode) flyBadge.parentNode.removeChild(flyBadge)
      finishStore(slotIdx, badgeSrc)
    })
  }, [phase, current, activeSlot, frameRef, finishStore])

  // ── Store-all (Collect-All) ───────────────────────────────────────────
  // Snap-fill every resolved slot with its badge in one setState. The
  // existing slotPop CSS keyframe runs on each <img> as it mounts, giving a
  // satisfying unison pop without any per-card animation pipeline.
  //
  // Where we go next depends on whether the stream has settled:
  //   - settled  → straight to 'done' (the finale); nothing more will arrive.
  //   - still open → stay in 'browsing' and latch collectAllActive so each
  //     later arrival auto-fills too (see the auto-fill effect); the settle→
  //     done effect fires the finale once the stream settles. This is the fix
  //     for "Collect-All at card 4 of 10 silently drops cards 5..10".
  //
  // Allowed from BOTH 'browsing' and 'revealing'. If the user is mid-flow with
  // a card on screen we stop any in-flight legendary aura and cancel the
  // in-flight store (the card's slot is included in the snap-fill).
  const storeAll = useCallback(async () => {
    if (seqPhase !== 'browsing' && seqPhase !== 'revealing') return
    // Cancel any in-flight single-card store FIRST (synchronously, before the
    // await) so its onComplete can't fire after we've moved to the finale (or
    // back to browsing for auto-collect) and reset the sequence state out from
    // under us — which, with finaleFiredRef already latched, broke the finale.
    storeCancelRef.current?.()
    storeCancelRef.current = null
    if (current?.isRare) {
      sfx.stopLoop('legendary-aura-loop')
    }
    setCollectAllPending(true)
    await awaitFullLoad()
    setCollectAllPending(false)

    sfx.play('cascade-start')
    // No cascade-start haptic — snap-fill is the impactful moment and
    // they fire back-to-back; the engine's anti-fatigue throttle would
    // otherwise drop snap-fill. One coalesced impact pulse here, not
    // N (one per slot) and not paired with a tap-ack.
    //
    // Read cards via the ref, not the closure: more attestations may
    // have arrived during awaitFullLoad, and the closure-captured
    // `cards` would only have the snapshot from when the user tapped.
    setFilled(() => cardsRef.current.map((c) => c.badgeSrc))
    haptic.play('snap-fill')
    setActiveSlot(-1)
    setPhase('idle')

    if (streamSettledRef.current) {
      // Nothing more will arrive — straight to the finale.
      setSeqPhase('done')
    } else {
      // Stream still open: stay in 'browsing' and latch auto-collect so each
      // later arrival snap-fills too (see the auto-fill effect). The settle→
      // done effect fires the finale once the stream settles. Jumping to
      // 'done' here would freeze the shelf at the current count and silently
      // drop every collectible still streaming in.
      setCollectAllActive(true)
      setSeqPhase('browsing')
    }
  }, [seqPhase, awaitFullLoad, current])

  // ── Tap-to-view on finale ─────────────────────────────────────────────
  const dismissView = useCallback(() => {
    if (seqPhase !== 'viewing' || !current) return
    const api = cardRefs.current[current.id]
    if (!api) {
      setSeqPhase('done')
      setPhase('idle')
      setActiveSlot(-1)
      return
    }
    api.root()?.classList.remove('is-viewing')
    gsap.to(api.root(), {
      opacity: 0,
      scale: 0.94,
      duration: 0.25,
      ease: 'power2.in',
      onComplete: () => {
        setSeqPhase('done')
        setPhase('idle')
        setActiveSlot(-1)
      }
    })
    sfx.play('card-dissolve')
  }, [seqPhase, current])

  const onBadgeClick = useCallback((slotIdx: number) => {
    if (seqPhase !== 'done' && seqPhase !== 'viewing') return
    if (!filled[slotIdx]) return
    // Tapping the same slot during 'viewing' dismisses; tapping a
    // different one during 'viewing' currently requires a dismiss-then-
    // tap (the tap-zone overlays the slot-button). First-version sticks
    // with the simple model.
    if (seqPhase === 'viewing' && activeSlot === slotIdx) {
      dismissView()
      return
    }
    setActiveSlot(slotIdx)
    setSeqPhase('viewing')
    setPhase('revealed')
    sfx.play('tap-open')
  }, [seqPhase, activeSlot, filled, dismissView])

  // Action-label mode during reveal:
  //   phase 'ready' + readyToReveal → 'release' ("Reveal!")
  //   phase 'ready'                 → 'open'    ("Tap and hold")
  //   phase 'revealed'              → 'store'   ("Tap for next")
  // The "Hold…" intermediate state was removed — it only showed for
  // the brief 466ms before threshold-cross and read as distracting
  // visual churn.
  const buttonMode: ActionMode =
    seqPhase !== 'revealing' ? null :
      phase === 'ready' ? (readyToReveal ? 'release' : 'open') :
      phase === 'revealed' ? 'store' :
      null

  // Plain tap on the revealed card → store it. (Tap-and-hold charge + swipe
  // are handled separately in the pointer handlers.) Taps during the
  // transient enter/flipping/storing phases do nothing.
  //
  // There used to be a 'store' tap-queue here: a tap during 'enter'/'flipping'
  // queued a store that fired the instant the card revealed. That only made
  // sense with auto-burst chaining (enter → revealed automatically). Chaining
  // was removed — every reveal now requires a deliberate tap-and-hold — so the
  // queued store would fling a just-revealed card to the shelf before the user
  // ever saw its face. Removed (along with the flush effect + pendingActionRef).
  const onQueuedTap = useCallback(() => {
    if (seqPhase !== 'revealing') return
    if (phase === 'revealed') onStore()
  }, [seqPhase, phase, onStore])

  // ── Charge (tap-and-hold) + Swipe-to-store handlers ──────────────────
  //
  // The tap-zone serves TWO distinct gestures depending on phase:
  //
  //   phase === 'ready'    — tap-and-hold to CHARGE the orb. On release,
  //                          if the charge is above threshold, commit
  //                          (performReveal); otherwise cancel back to 0.
  //                          Plain taps do nothing during 'ready' — the
  //                          user MUST hold. The action-label cues them.
  //
  //   phase === 'revealed' — tap or swipe to STORE. Swipe past
  //                          SWIPE_TRIGGER_PX horizontally triggers
  //                          immediate cardStore from the drag position.
  //
  // Charge + swipe state are tracked in separate refs so their pointer
  // dispatches don't interfere. A short-lived suppression flag prevents
  // the trailing click event from re-firing onStore after a swipe or
  // re-firing onOpen after a charge release.

  // Swipe state for revealed-phase store gesture.
  const SWIPE_TRIGGER_PX = 80
  const swipeStateRef = useRef<{
    startX: number
    startY: number
    dx: number
    isSwiping: boolean
    cardEl: HTMLElement | null
  } | null>(null)
  const justSwipedRef = useRef(false)

  // Charge state for ready-phase tap-and-hold.
  // CHARGE_THRESHOLD: minimum charge value (0..1) required to commit the
  // reveal on release. Below this, the orb resets and the user can try
  // again. 0.3 is forgiving — a brief hold counts.
  // CHARGE_DURATION: seconds to reach full charge. Tuned from 1.2 →
  // 0.85 — felt laborious at 1.2 (~660ms before "Reveal!" appeared).
  // At 0.85s with the power2.in ease, threshold crosses at ~466ms,
  // total possible hold ~850ms. Snappier without feeling automatic.
  const CHARGE_THRESHOLD = 0.3
  const CHARGE_DURATION = 0.85
  const chargeStateRef = useRef<{
    api: OrbApi
    card: CardData
    tween: gsap.core.Tween
  } | null>(null)
  const justChargedRef = useRef(false)

  const tapZonePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (seqPhase !== 'revealing' || !current) return

    // Phase 'ready' → start charging the orb.
    if (phase === 'ready') {
      const api = cardRefs.current[current.id]
      if (!api) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const charge = api.charge()
      charge.value = 0
      readyToRevealRef.current = false
      setReadyToReveal(false)
      const tween = gsap.to(charge, {
        value: 1,
        duration: CHARGE_DURATION,
        ease: 'power2.in',
        // When the charge crosses the commit threshold, flip the
        // action-label to "Reveal!" and fire a haptic tick. Guarded
        // by readyToRevealRef so we only setState + buzz once per
        // hold, not every frame.
        onUpdate: () => {
          if (
            !readyToRevealRef.current &&
            charge.value >= CHARGE_THRESHOLD
          ) {
            readyToRevealRef.current = true
            setReadyToReveal(true)
            haptic.play('threshold-cross')
          }
        }
      })
      chargeStateRef.current = { api, card: current, tween }
      return
    }

    // Phase 'revealed' → set up swipe-to-store gesture.
    if (phase === 'revealed') {
      const cardEl = cardRefs.current[current.id]?.root() ?? null
      if (!cardEl) return
      swipeStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        isSwiping: false,
        cardEl
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
  }, [seqPhase, phase, current])

  const tapZonePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Swipe drift for revealed-phase store.
    const s = swipeStateRef.current
    if (s) {
      s.dx = e.clientX - s.startX
      const dy = e.clientY - s.startY
      if (!s.isSwiping && Math.abs(s.dx) > 8 && Math.abs(s.dx) > Math.abs(dy) * 1.1) {
        s.isSwiping = true
      }
      if (s.isSwiping && s.cardEl) {
        gsap.set(s.cardEl, {
          x: s.dx,
          rotation: s.dx * 0.04
        })
      }
    }
    // Charge phase: we allow finger drift during hold (user might slide
    // slightly while pressing). Phase 2 doesn't cancel on drift — the
    // hold is committed until release.
  }, [])

  const tapZonePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const target = e.currentTarget
    if (target && target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }

    // Charge release first (mutually exclusive with swipe state).
    const charge = chargeStateRef.current
    if (charge) {
      chargeStateRef.current = null
      charge.tween.kill()
      const value = charge.api.charge().value
      // Reset the threshold-crossed flag (commit + cancel both clear).
      readyToRevealRef.current = false
      setReadyToReveal(false)
      // Suppress the trailing click in BOTH outcomes — commit and
      // cancel — so a tapped-then-released hold doesn't also fire
      // onQueuedTap below.
      justChargedRef.current = true
      window.setTimeout(() => { justChargedRef.current = false }, 300)
      if (value >= CHARGE_THRESHOLD) {
        performReveal(charge.api, charge.card, value)
      } else {
        // Tween charge back to 0; user can re-grip.
        revealChargeCancel(charge.api)
      }
      return
    }

    // Swipe release.
    const s = swipeStateRef.current
    swipeStateRef.current = null
    if (!s) return
    if (!s.isSwiping) return  // pure tap — let the click handler run
    justSwipedRef.current = true
    window.setTimeout(() => { justSwipedRef.current = false }, 300)
    if (Math.abs(s.dx) > SWIPE_TRIGGER_PX) {
      onStore()
    } else if (s.cardEl) {
      gsap.to(s.cardEl, {
        x: 0,
        rotation: 0,
        duration: 0.28,
        ease: 'power2.out'
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStore])

  const tapZoneClick = useCallback(() => {
    if (justSwipedRef.current) return
    if (justChargedRef.current) return
    // Plain taps during 'ready' phase do nothing — the user must hold
    // to charge. tap-and-hold goes through pointerdown/pointerup above.
    if (phase === 'ready') return
    onQueuedTap()
  }, [onQueuedTap, phase])

  const renderCard = (seqPhase !== 'done' && current && phase !== 'idle')
                  || (seqPhase === 'viewing' && current)
  // Item-name caption: shown once the card face is revealed, and while
  // inspecting a stored card. Hidden during enter/flip/store so it
  // doesn't fight the motion.
  const nameVisible = !!current && (phase === 'revealed' || seqPhase === 'viewing')
  const galaxyActive =
    phase === 'flipping' ||
    phase === 'revealed' ||
    phase === 'storing'

  return (
    <>
      <div className="bg-breath" aria-hidden="true" />

      <SlotGrid
        ref={slotRef}
        filled={filled}
        silhouettes={seqPhase === 'browsing' && !collectAllActive ? silhouettes : Array(cards.length).fill(null)}
        readySlots={readySlots}
        onSilhouetteClick={onSilhouetteClick}
        active={galaxyActive}
        isFinale={finaleVisible}
        onBadgeClick={onBadgeClick}
        cardCount={SHELF_SIZE}
      />

      {/* Translucent dim overlay above the shelves but below the card,
          so the focused card pops while the shelves stay readable as
          context. Driven by the same predicate as renderCard. */}
      <div
        className="shelf-dim"
        aria-hidden="true"
        data-active={renderCard ? 'true' : 'false'}
      />

      <div className="stage-overlay">
        <ParticleCanvas ref={particleRef} />
        <div className="fly-layer" ref={flyLayerRef} aria-hidden="true" />
        <div className="screen-dim" ref={dimRef} aria-hidden="true" />
        <div className="screen-flash" ref={flashRef} aria-hidden="true" />

        <div className="card-slot">
          {renderCard && current && (
            <OrbScene
              key={`${activeSlot}-${current.id}`}
              badgeSrc={current.badgeSrc}
              isRare={current.isRare}
              onOrbReady={() => {
                // Fire whatever spawn the effect armed for THIS slot.
                // Stable closure: pendingSpawnRef.current is set/cleared
                // by the effect on entering/leaving 'enter' phase.
                const pending = pendingSpawnRef.current
                if (pending) {
                  pendingSpawnRef.current = null
                  pending()
                }
              }}
              ref={(h) => {
                if (h) cardRefs.current[current.id] = h
                else delete cardRefs.current[current.id]
              }}
            />
          )}
          {renderCard && current && current.name && (
            <div
              className="card-name-label"
              data-visible={nameVisible ? 'true' : 'false'}
              aria-hidden={!nameVisible}
            >
              {current.collection && (
                <div className="card-name-collection">{current.collection}</div>
              )}
              <div className="card-name-text">{current.name}</div>
            </div>
          )}
        </div>

        {/* Full-area tap catcher: makes the whole card + surrounding area
            the hit target. Rendered during ALL revealing phases (not just
            ready/revealed) so taps during enter/flipping queue an intent
            via onQueuedTap. Sits above the card (z: 15) but below the
            floating controls (collect-all z:22, dev replay z:100). */}
        {seqPhase === 'revealing' && (
          <button
            type="button"
            className="tap-zone"
            onClick={tapZoneClick}
            onPointerDown={tapZonePointerDown}
            onPointerMove={tapZonePointerMove}
            onPointerUp={tapZonePointerUp}
            onPointerCancel={tapZonePointerUp}
            aria-label={
              buttonMode === 'store' ? 'Tap or swipe to store' :
              'Reveal in progress'
            }
          />
        )}

        {/* Viewing tap-zone — tap anywhere (card or background) to
            dismiss the inspected card and return to the finale view. */}
        {seqPhase === 'viewing' && (
          <button
            type="button"
            className="tap-zone"
            onClick={dismissView}
            aria-label="Close"
          />
        )}

        <ActionLabel mode={buttonMode} />

        <div
          className="finale-label"
          data-visible={finaleVisible ? 'true' : 'false'}
          data-viewing={seqPhase === 'viewing' ? 'true' : 'false'}
          aria-hidden={!finaleVisible}
        >
          Collection complete!
        </div>

        {continueVisible && seqPhase !== 'viewing' && onComplete && (
          <button
            type="button"
            className="stage-continue"
            onClick={onComplete}
          >
            Continue
          </button>
        )}
      </div>

      <CollectAllButton
        visible={collectAllVisible && (seqPhase === 'browsing' || seqPhase === 'revealing')}
        onTap={storeAll}
        pending={collectAllPending}
      />

      {/* Escape-hatch overlay (see the stuck-timer effect). Shown after a
          STUCK_TIMEOUT_MS lull when the user can't progress — either
          nothing loaded yet, or native under-delivered and the user has
          revealed all that arrived. Copy adapts to which case it is. */}
      {stuckOverlayVisible && (
        <div className="stage-stuck-overlay" aria-live="polite">
          <div className="stage-stuck-headline">
            {streamSettled ? "That's the round." : "Still securing your collectibles."}
          </div>
          <div className="stage-stuck-sub">
            {streamSettled ? "Continue when you're ready." : "Hang tight — or continue and check your Pocket."}
          </div>
          <button
            type="button"
            className="stage-stuck-continue"
            onClick={handleStuckContinue}
          >
            Continue
          </button>
        </div>
      )}

    </>
  )
}
