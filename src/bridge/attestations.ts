// Attestation streaming channel.
//
// After a game ends, native streams one attestation per passed-attestation
// over to the webview. Each push lands in a Map keyed by index; the NFT
// reveal screen subscribes and reactively populates its silhouettes as
// pushes arrive.
//
// Native may call window.pushAttestation at any time during the WebView
// lifetime — before the webview has mounted, before the user reaches
// the NFT reveal screen, or while the screen is open. The channel
// buffers everything until a subscriber registers, same buffer-or-
// deliver pattern as setDisplayName / setUsernameAvailability.

import type { AttestationPayload } from './types'

type Listener = (payload: AttestationPayload) => void

// Keyed by index so duplicate pushes (e.g., native retried) replace
// rather than duplicate. The webview reasons about a "slot" being
// filled vs not based on index presence.
const buffered = new Map<number, AttestationPayload>()
const listeners = new Set<Listener>()

function isValidHash(v: unknown): v is string {
  // Lenient — accept any non-empty string. Native owns the actual hash
  // format. Trim + length check protects against accidental empty
  // strings without imposing a specific encoding.
  return typeof v === 'string' && v.trim().length > 0
}

;(window as unknown as Record<string, unknown>).pushAttestation = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return
  const obj = raw as Record<string, unknown>
  // Cap the index: the shelf is small (SHELF_SIZE), so a wildly
  // out-of-range index is a native bug — reject it rather than let the
  // buffer Map grow unbounded.
  if (typeof obj.index !== 'number' || !Number.isFinite(obj.index) || obj.index < 0 || obj.index >= 64) return
  if (!isValidHash(obj.hash)) return
  const payload: AttestationPayload = {
    index: Math.floor(obj.index),
    hash: obj.hash.trim()
  }
  if (obj.highValue === true) payload.highValue = true
  buffered.set(payload.index, payload)
  for (const cb of listeners) {
    try { cb(payload) } catch { /* listener exceptions can't break the channel */ }
  }
}

/** Subscribe to attestation pushes. The subscriber is invoked once for
 *  every push received so far (buffered), then again for each new push.
 *  Returns an unsubscribe function. */
export function subscribeAttestations(cb: Listener): () => void {
  listeners.add(cb)
  // Replay buffered pushes in index order so subscribers can rebuild
  // their state deterministically regardless of arrival order.
  const sorted = Array.from(buffered.values()).sort((a, b) => a.index - b.index)
  for (const p of sorted) {
    try { cb(p) } catch { /* see above */ }
  }
  return () => { listeners.delete(cb) }
}

/** Clear all buffered attestations + subscribers. Used by dev panel
 *  when loading a fresh mock so old streams don't bleed into the new
 *  scenario. Not called in production. */
export function resetAttestations(): void {
  buffered.clear()
  listeners.clear()
}

/** Total attestations received so far, across ALL indices (0..63). Note
 *  this includes off-shelf indices the reveal never renders — use
 *  onShelfAttestationCount for settle/render decisions. */
export function bufferedAttestationCount(): number {
  return buffered.size
}

/** Count of buffered attestations whose index falls WITHIN the shelf
 *  (0..shelfSize-1). The settle gate uses this — NOT bufferedAttestationCount
 *  — because native can push indices up to 63, and the shelf drops anything
 *  >= shelfSize. Counting off-shelf pushes would "settle" the reveal over an
 *  empty shelf (e.g. ten pushes at indices 20-29). */
export function onShelfAttestationCount(shelfSize: number): number {
  let n = 0
  for (const idx of buffered.keys()) if (idx < shelfSize) n++
  return n
}
