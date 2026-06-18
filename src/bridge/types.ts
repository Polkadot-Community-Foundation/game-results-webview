// Native bridge contract — single source of truth for all data
// crossing the webview boundary.
//
// Lifecycle: native sets window.__GAME_RESULTS__ before the webview
// finishes loading, OR calls window.setGameResults(input) at any
// point after. Either path resolves to the same React state.

/**
 * @deprecated Rank/ranking was removed from the webview. This type is
 * retained only so the deprecated `MemberState.rankBefore` / `rankAfter`
 * fields keep their shape for bridge-contract compatibility — native may
 * keep sending rank, but the webview no longer reads or renders it. Safe
 * to drop in a future contract bump.
 */
export type MemberRank =
  | 'spark' | 'ignition' | 'flame' | 'fire' | 'blaze'   // candidate
  | 'fresh' | 'returning' | 'regular' | 'familiar'
  | 'reliable' | 'strong' | 'enduring'
  | 'veteran' | 'hero' | 'legend' | 'mythic'
  | 'immortal' | 'apex' | 'eternal'

export interface Attestations {
  /** Total possible attestations (the shelf size). Typically 10. The only
   *  field knowable upfront under the streaming-outcome model. */
  total: number
  /** Positive attestations earned this game. 0..total.
   *  @deprecated upfront — NOT knowable at setGameResults time (attestations
   *  stream in; see STREAMING_OUTCOME_PROPOSAL.md / setGameOutcome). Optional:
   *  old native may still send it and the webview tolerates it. */
  score?: number
  /** True iff the user passed (>= 6 of 10). Native-authoritative.
   *  @deprecated upfront — moved to setGameOutcome (the outcome is derived
   *  from the attestation stream). Optional: if old native sends it HERE, its
   *  presence makes the webview synthesize the outcome from it (back-compat). */
  passed?: boolean
}

export interface MemberState {
  /** @deprecated Rank/ranking was removed from the webview UI. Now
   *  OPTIONAL — native may omit it entirely; if sent it is ignored.
   *  (Historically: rank before this game; null = first game ever.) */
  rankBefore?: MemberRank | null
  /** @deprecated Rank/ranking was removed from the webview UI. Now
   *  OPTIONAL — native may omit it entirely; if sent it is ignored.
   *
   *  Historical semantics: rank after this game. null on a candidate-tier
   *  failure (all progression wiped — there was never any downranking);
   *  member failure kept rank (`rankAfter === rankBefore`). The webview
   *  no longer distinguishes these — failure copy is uniform. */
  rankAfter?: MemberRank | null
  /** True iff this game crossed candidate → member. Drives the results
   *  celebration variant, prize-draw eligibility, and the username CTA.
   *  This is the personhood signal and remains load-bearing. */
  justBecameMember: boolean
  /** @deprecated Rank progression was removed from the webview UI. Now
   *  OPTIONAL — native may omit it; if sent it is ignored. */
  gamesInRank?: number
  /** @deprecated Rank progression was removed from the webview UI. Now
   *  OPTIONAL — native may omit it; if sent it is ignored. */
  gamesPerRank?: number
  /** Optional display name (e.g., "ERIN"). Max 24 chars; native should
   *  sanitize. Shown on the membership card. */
  displayName?: string
  /** ISO date the user first became a member, if past it. Optional;
   *  currently unused by any screen. */
  memberSince?: string
}

export interface PrizeDraw {
  /** Prize amount in **whole units** — NOT dollars, NOT micro-units.
   *  Typical values: 200 (normal draw), 2000 (bonus draw).
   *  Displayed as `"<value> CASH"` (e.g. "200 CASH"). The webview derives
   *  "this is a bonus draw" purely from this number — no separate
   *  cadence flag.
   *
   *  Field name is a legacy artifact from when the design was
   *  dollar-denominated. Native should keep sending the amount
   *  in this field; a future contract bump will likely rename it.
   *  The display formatter (ResultHero.tsx:formatPrize) is the single
   *  source of truth for the unit string. */
  prizeUsd: number
  /** The user's ticket for this draw — a 32-byte hash represented as
   *  a 64-character lowercase hex string. The raw hash is never shown
   *  to the user; the webview derives a short friendly display code
   *  from it (see src/draw/ticketDisplay.ts). */
  userTicket: string
  /** All winning ticket hashes for this draw — same hex-string shape
   *  as `userTicket`. Typically ~20 winners per draw. May contain
   *  `userTicket` if they won. */
  winningTickets: string[]
  /** @deprecated Now OPTIONAL — native may omit it; if sent it is
   *  ignored. The chain does not expose a real ticket-distance value, so
   *  the webview simulates one deterministically from `userTicket` (see
   *  src/draw/ticketDistance.ts) and overrides whatever native passes.
   *  When chain support lands, drop the simulation and this becomes
   *  authoritative again — no contract change needed (just re-require it).
   *
   *  Historical semantics: number of tickets between the user's ticket
   *  and the nearest winning ticket; 0 = the user won. */
  ticketDistance?: number
  /** @deprecated Now OPTIONAL — native may omit it; the webview no
   *  longer displays it. (Historically drove the "N winners drawn from
   *  X entries" framing copy.) If sent, it still sizes the simulated
   *  ticket-distance pool; when absent the simulation falls back to a
   *  default pool size. */
  totalEntries?: number
  /** ISO 8601 timestamp of the next draw. Drives the countdown on the
   *  result stage. Native owns the schedule — the webview never computes
   *  draw cadence. */
  nextDrawAt: string
  /** Native-authoritative outcome. Renderer plays the ceremony but
   *  never decides the result. (Historically equivalent to
   *  `ticketDistance === 0`, but `ticketDistance` is now deprecated —
   *  `won` is the sole authoritative win/loss signal.) */
  won: boolean
}

/** Availability of the base (no-suffix) member username on People Chain.
 *
 *  Native is responsible for querying the chain (`Identity::usernameOwnerOf`
 *  + `Identity::usernameReservationQueue`) and pushing the result. The
 *  webview never queries the chain directly. Three states:
 *
 *  - 'available'  → base name is free; play the suffix-drop ceremony.
 *  - 'taken'      → base name is claimed by someone else; show the
 *                   name-taken variant with `alternatives` if provided.
 *  - 'unknown'    → query failed, timed out, or doesn't apply; webview
 *                   falls back to the cautious generic variant (no
 *                   suffix-drop, no specific name shown).
 *
 *  Absence is treated as "not yet resolved" — the webview shows the
 *  cautious variant after a short wait. */
export type UsernameAvailability = 'available' | 'taken' | 'unknown'

export interface UsernameClaim {
  /** True iff this user is eligible to claim a custom username (in the
   *  Prizes chat). */
  eligible: boolean
  /** The clean member-tier handle the user can now claim, e.g. "byteboro".
   *  No suffix — that's what the candidate-tier name uses. */
  suggestedUsername?: string
  /** Optional candidate-tier name the user had before becoming a member,
   *  e.g. "byteboro.42". If omitted, the UI synthesizes `${suggested}.01`
   *  so the candidate→member transition animation still has a sensible
   *  starting point. */
  previousUsername?: string
  /** Native-authoritative result of the People Chain availability query
   *  for `suggestedUsername`. Optional: native MAY include this in the
   *  initial `setGameResults` payload OR push it later via
   *  `window.setUsernameAvailability(...)`. Absence means "not yet known"
   *  and the webview will show a cautious generic variant until/unless
   *  it arrives. */
  availability?: UsernameAvailability
  /** Suggested alternative names returned by native when `availability`
   *  is 'taken'. Display-only — the webview never claims a name itself;
   *  the user picks one in the Prizes chat. Up to 5 names, each ≤24 chars. */
  alternatives?: string[]
}

export interface GameResultsInput {
  attestations: Attestations
  member: MemberState
  /** null when no prize draw applies (e.g., user didn't just become a member). */
  prizeDraw: PrizeDraw | null
  usernameClaim: UsernameClaim
}

/** The game outcome + everything gated on passing. Delivered via
 *  `window.setGameOutcome(...)` when native's streamed attestation count
 *  reaches the passing threshold (6) — see §2.5 / §7 of NATIVE_SPEC and
 *  STREAMING_OUTCOME_PROPOSAL.md. NOT part of GameResultsInput because it
 *  isn't knowable at setGameResults time (the attestations are the result).
 *
 *  The webview also synthesizes one of these from a legacy `setGameResults`
 *  that still carries `attestations.passed` (back-compat). */
export interface GameOutcome {
  /** Whether the user passed. The `false` form is the (optional) ~10-min
   *  native timeout signal — a definitive failure. */
  passed: boolean
  /** Crossed candidate → member this game. Drives the celebration variant. */
  justBecameMember: boolean
  /** The prize draw, or null when none applies (failed, or passing candidate). */
  prizeDraw: PrizeDraw | null
  /** Username-claim state (members only). */
  usernameClaim: UsernameClaim
}

/** A single passed attestation, pushed by native into the webview over
 *  time. One push per attestation; arrival order may differ from index
 *  order (the `index` field anchors each push to its slot in the user's
 *  attestation sequence).
 *
 *  The webview maps `hash` to a displayable NFT asset via the
 *  CollectableHashResolver-style resolver (`src/attestations/resolver.ts`):
 *  the first 2 bytes of the hash determine rarity, the next 2 pick
 *  the image from the appropriate (normal or rare) pool indexed by
 *  the bundled `cid_map.json`. Images are served from the Polkadot
 *  Bulletin Chain IPFS gateway. */
export interface AttestationPayload {
  /** 0-based slot in the user's attestation sequence. Determines which
   *  silhouette this attestation populates. Duplicate indices replace. */
  index: number
  /** The 32-byte attestation hash as a 64-character hex string,
   *  optionally prefixed with `0x`. The webview's resolver consumes
   *  the first 4 bytes (rarity + image pick) to deterministically map
   *  the hash to one image in the Bulletin-chain collection.
   *
   *  Format flexibility: leading `0x` is stripped if present;
   *  case-insensitive hex. Malformed hashes (wrong length, non-hex)
   *  fall back to the first available image and log a warning. */
  hash: string
  /** Optional advisory rarity flag from native. **Not authoritative**:
   *  the resolver derives rarity from the hash bytes, so the card art
   *  shown to the user is always consistent with the badge image. This
   *  field can be omitted; if sent, it's used only as a tentative
   *  hint while the resolver is in flight (sub-frame, in practice).
   *  Native may simply omit it. */
  highValue?: boolean
}

// Web→native events.
export type FlowEvent =
  | { type: 'flow.ready' }
  /** Treasure-chest screen mounted — the pre-reveal beat (now first). */
  | { type: 'flow.pack_shown' }
  /** User opened the chest, handing off into the collectibles reveal. */
  | { type: 'flow.pack_opened' }
  /** @deprecated No longer emitted — the standalone results screen was
   *  removed when the collectibles reveal became the first beat (its
   *  membership verdict now lands inline at the reveal finale). Kept in
   *  the union for back-compat. */
  | { type: 'flow.results_shown' }
  | { type: 'flow.prize_draw_started' }
  | { type: 'flow.prize_draw_complete'; won: boolean }
  | { type: 'flow.nft_reveal_started'; count: number }
  | { type: 'flow.nft_reveal_complete' }
  /** @deprecated No longer emitted. The username CTA's button is now a
   *  plain "Next" that just advances — claiming happens in the Prizes
   *  chat, not via a Pocket deep-link. Kept in the union for back-compat;
   *  native may keep a handler, but it will never fire. */
  | { type: 'flow.username_claim_requested' }
  /** Webview asks native for the user's display name. Native replies by
   *  calling window.setDisplayName(name) at any point thereafter. */
  | { type: 'flow.request_display_name' }
  /** Webview is about to need username availability and hasn't received it.
   *  Native should query People Chain for the base name and call
   *  window.setUsernameAvailability(...) when the result is ready. Fired
   *  at most once per session. */
  | { type: 'flow.username_availability_needed'; name: string }
  /** Webview-side error worth surfacing for telemetry. `phase` identifies
   *  the area (e.g. 'boot_timeout', 'assets'); `detail` is optional. */
  | { type: 'flow.error'; phase: string; detail?: string }
  | { type: 'flow.complete' }
