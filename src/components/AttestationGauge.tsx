// AttestationGauge — a small segmented bar gauge (lower-left HUD) showing how
// many collectibles ("attestations") have streamed in from native so far.
//
// The designer's demo surfaced this as a numerical "X / N" readout; this is the
// visual equivalent: one segment per shelf slot, lit as each on-shelf
// attestation arrives. Self-subscribes to the attestation channel, so it can be
// dropped onto any screen during the streaming/reveal phase without wiring.

import { useEffect, useState } from 'react'
import { subscribeAttestations, onShelfAttestationCount } from '../bridge/attestations'
import { SHELF_SIZE } from './Stage'

export default function AttestationGauge() {
  const [count, setCount] = useState(() => onShelfAttestationCount(SHELF_SIZE))

  useEffect(() => {
    // subscribeAttestations replays buffered pushes immediately, then fires on
    // each new arrival — recompute the on-shelf count either way.
    const off = subscribeAttestations(() => setCount(onShelfAttestationCount(SHELF_SIZE)))
    return off
  }, [])

  return (
    <div
      className="att-gauge"
      role="img"
      aria-label={`${count} of ${SHELF_SIZE} collectibles in`}
    >
      <div className="att-gauge-track" aria-hidden="true">
        {Array.from({ length: SHELF_SIZE }, (_, i) => (
          <span key={i} className={`att-gauge-seg${i < count ? ' is-filled' : ''}`} />
        ))}
      </div>
    </div>
  )
}
