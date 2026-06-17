// NFTRevealScreen — the collectibles reveal, the FIRST major beat (the
// treasure chest precedes it and provides the context).
//
// The shelf fills from the live attestation stream. There is no known total
// upfront anymore, so the reveal doesn't wait for a fixed count — it lets
// the user collect whatever arrives and fires the finale once the user has
// stored everything AND the stream has "settled" (`streamSettled`, computed
// in App: outcome resolved / stream went quiet / all 10 in / foreground cap).
// On Continue, App routes to the membership verdict if the outcome resolved,
// otherwise to the Prizes-chat handoff.

import type { RefObject } from 'react'
import { useEffect } from 'react'
import Stage, { SHELF_SIZE } from '../components/Stage'
import { sendFlowEvent } from '../bridge/send'
import { onShelfAttestationCount } from '../bridge/attestations'
import type { ShelfFlyItem } from '../anim/shelfFly'

interface NFTRevealScreenProps {
  frameRef: RefObject<HTMLDivElement>
  /** True once the webview stops waiting for more cards. Drives the finale. */
  streamSettled: boolean
  onContinue: () => void
  /** Forwarded to Stage — the shelf snapshot for the album-close fly. */
  onShelfCaptured?: (items: ShelfFlyItem[]) => void
  /** Forwarded to Stage — fires when the reveal finale lands (all opened). */
  onFinale?: () => void
}

export default function NFTRevealScreen({ frameRef, streamSettled, onContinue, onShelfCaptured, onFinale }: NFTRevealScreenProps) {
  useEffect(() => {
    // count = on-shelf attestations received so far (no known total upfront;
    // off-shelf indices are dropped by the shelf, so they don't count here).
    sendFlowEvent({ type: 'flow.nft_reveal_started', count: onShelfAttestationCount(SHELF_SIZE) })
  }, [])

  return (
    <Stage
      frameRef={frameRef}
      streamSettled={streamSettled}
      {...(onShelfCaptured ? { onShelfCaptured } : {})}
      {...(onFinale ? { onFinale } : {})}
      onComplete={() => {
        sendFlowEvent({ type: 'flow.nft_reveal_complete' })
        onContinue()
      }}
    />
  )
}
