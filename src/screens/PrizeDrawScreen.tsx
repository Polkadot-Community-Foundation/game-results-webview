// PrizeDrawScreen — orchestrates the three sub-stages of the prize-draw
// ceremony:
//
//   sealed  → user sees their ticket, taps REVEAL
//   reveal  → perspective lane scene runs the draw cinematic
//   result  → hero ticket + headline (prize / distance) + countdown + CTA
//
// The screen is one node in App.tsx's stage machine (screen === 'prize_draw').
// Internally it has its own three-phase state and renders the matching
// sub-stage component.
//
// Reduced-motion path: skips 'reveal' entirely; jumps sealed → result so
// the user gets the outcome without the multi-second cinematic.
//
// Bridge events:
//   flow.prize_draw_started  → fires on sealed → reveal transition
//   flow.prize_draw_complete → fires when user taps the result-stage CTA
//                              (carried by onContinue → App.advance)

import { useEffect, useMemo, useState } from 'react'
import { prefersReducedMotion } from '../anim/easings'
import { sendFlowEvent } from '../bridge/send'
import SealedStage from '../draw/SealedStage'
import LaneScene from '../draw/LaneScene'
import ResultHero from '../draw/ResultHero'
import { loadDrawAssets, type DrawAssets } from '../draw/assets'
import { simulateTicketDistance } from '../draw/ticketDistance'
import type { EffectiveDraw } from '../draw/types'
import type { PrizeDraw } from '../bridge/types'

type SubStage = 'sealed' | 'reveal' | 'result'

interface PrizeDrawScreenProps {
  draw: PrizeDraw
  /** Display name shown on YOU marker + hero ticket meta. */
  name?: string
  /** True when this game crossed candidate → member. Drives the new-
   *  member consolation overlay on the loss path. */
  justBecameMember?: boolean
  /** Called when the user taps the post-draw CTA. */
  onContinue: () => void
}

export default function PrizeDrawScreen({
  draw,
  name,
  justBecameMember,
  onContinue
}: PrizeDrawScreenProps) {
  const [stage, setStage] = useState<SubStage>('sealed')
  const [assets, setAssets] = useState<DrawAssets | null>(null)

  // ── Ticket-distance simulation shim ───────────────────────────────
  // The chain doesn't yet expose a real ticket-distance value, so
  // `draw.ticketDistance` from the bridge is meaningless for now. We
  // override it here with a deterministic value derived from the user's
  // ticket hash. All downstream consumers (outcomeFor, LaneScene,
  // ResultHero) keep reading `draw.ticketDistance` as if it were real;
  // they don't need to know about the shim.
  //
  // To DELETE the shim once the chain supports real ticket-distance:
  //   1. Remove the `useMemo` block below.
  //   2. Pass the original `draw` to all three sub-stages instead of
  //      `effectiveDraw`.
  //   3. Delete the import of `simulateTicketDistance` (above).
  //   4. Optionally delete `src/draw/ticketDistance.ts`.
  //
  // The simulation is deterministic per `userTicket`, so refreshing or
  // replaying gives a stable result. Dev-panel mocks that set explicit
  // `ticketDistance` values are intentionally overridden — the
  // simulation is the single source of truth until the chain catches up.
  const effectiveDraw = useMemo<EffectiveDraw>(() => {
    // Winners don't use ticketDistance; 0 keeps the type honest (and
    // matches the historical "0 = won" convention).
    if (draw.won) return { ...draw, ticketDistance: 0 }
    return {
      ...draw,
      ticketDistance: simulateTicketDistance(
        draw.userTicket,
        draw.totalEntries,
        draw.winningTickets.length
      )
    }
  }, [draw])

  // Load + process ticket assets once. Results cached across screen
  // mounts via the loadDrawAssets module-level cache.
  useEffect(() => {
    let cancelled = false
    loadDrawAssets().then((a) => {
      if (!cancelled) setAssets(a)
    })
    return () => { cancelled = true }
  }, [])

  // `won` is native-authoritative; `winningTickets` is display data. If they
  // contradict, the cinematic would otherwise misrepresent the result — light
  // the user's own code gold under a "no win" verdict (won:false but the
  // ticket is in the list), or fabricate a rank (won:true but absent). Surface
  // the mismatch for telemetry; LaneScene + ResultHero defend the visuals.
  useEffect(() => {
    const inWinners = draw.winningTickets.includes(draw.userTicket)
    if (draw.won && draw.winningTickets.length > 0 && !inWinners) {
      sendFlowEvent({ type: 'flow.error', phase: 'draw_mismatch', detail: 'won_not_in_winners' })
    } else if (!draw.won && inWinners) {
      sendFlowEvent({ type: 'flow.error', phase: 'draw_mismatch', detail: 'loss_in_winners' })
    }
  }, [draw])

  function handleReveal(): void {
    sendFlowEvent({ type: 'flow.prize_draw_started' })
    if (prefersReducedMotion()) {
      // Skip the cinematic — go straight to result.
      setStage('result')
    } else {
      setStage('reveal')
    }
  }

  function handleRevealComplete(): void {
    setStage('result')
  }

  function handleContinue(): void {
    sendFlowEvent({ type: 'flow.prize_draw_complete', won: effectiveDraw.won })
    onContinue()
  }

  // Assets loading: brief blank while in flight. Sealed stage will
  // render as soon as they resolve. Typically <100ms after mount due
  // to the loadDrawAssets cache.
  if (!assets) {
    return <div className="draw-loading" aria-hidden="true" />
  }

  return (
    <div className="draw-screen">
      {stage === 'sealed' && (
        <SealedStage
          userTicket={effectiveDraw.userTicket}
          winnerCount={effectiveDraw.winningTickets.length}
          assets={assets}
          onReveal={handleReveal}
        />
      )}
      {stage === 'reveal' && (
        <LaneScene
          draw={effectiveDraw}
          assets={assets}
          {...(name ? { displayName: name } : {})}
          onComplete={handleRevealComplete}
        />
      )}
      {stage === 'result' && (
        <ResultHero
          draw={effectiveDraw}
          assets={assets}
          {...(name ? { displayName: name } : {})}
          {...(justBecameMember !== undefined ? { justBecameMember } : {})}
          onContinue={handleContinue}
        />
      )}
    </div>
  )
}
