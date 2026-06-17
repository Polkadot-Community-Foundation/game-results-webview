// Mock GameResultsInput shapes used by the ?dev=1 panel.
// Each variant exercises a distinct branch of the state machine.

import type { GameResultsInput } from './bridge/types'

// Helpers for generating plausible-looking ticket hashes + winning sets.
// The webview never reasons about the number space — these are just
// realistic-looking values for the placeholder draw UI to render.
// Tickets are 32-byte (64-char hex) hashes per the bridge contract.
function random32ByteHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let h = ''
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
}

function randomWinningSet(count: number = 20): string[] {
  const set = new Set<string>()
  while (set.size < count) set.add(random32ByteHex())
  return Array.from(set)
}

/** Build a winning-set that INCLUDES the given ticket. Used for win mocks. */
function winningSetIncluding(ticket: string): string[] {
  const set = new Set<string>([ticket])
  while (set.size < 20) set.add(random32ByteHex())
  return Array.from(set)
}

/** Build a winning-set that does NOT include the given ticket. The
 *  ticket distance is conveyed via the `ticketDistance` field, not by
 *  picking hashes that happen to be numerically close — the hash space
 *  is too large for "numerically near" to mean anything visual. */
function winningSetExcluding(ticket: string): string[] {
  const set = new Set<string>()
  while (set.size < 20) {
    const n = random32ByteHex()
    if (n !== ticket) set.add(n)
  }
  return Array.from(set)
}

/** Plausible-looking pool size — kept at 1337 per project convention
 *  for the dev mocks. Production gets the real count. */
const MOCK_TOTAL_ENTRIES = 1337

/** ISO timestamp for the next scheduled draw. The game (and its draw) runs
 *  twice a day, at 00:00 and 12:00 UTC, so the result-stage countdown has a
 *  plausible near-future value to render. */
function nextDrawIso(): string {
  const now = new Date()
  const target = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0
  ))
  // Advance in 12-hour steps to the next slot strictly in the future.
  while (target <= now) target.setUTCHours(target.getUTCHours() + 12)
  return target.toISOString()
}

function passJustBecameMemberWin(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 8, total: 10, passed: true },
    member: {
      rankBefore: 'blaze',
      rankAfter: 'fresh',
      justBecameMember: true,
      gamesInRank: 0,
      gamesPerRank: 2,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetIncluding(userTicket),
      ticketDistance: 0,
      won: true
    },
    // `availability: 'available'` + `previousUsername` are required to
    // trigger the suffix-drop ceremony (AvailableVariant) on the
    // username-claim screen — without them the variant selector falls
    // back to CautiousVariant and the ceremony never plays.
    usernameClaim: {
      eligible: true,
      suggestedUsername: 'byteboro',
      previousUsername: 'byteboro.42',
      availability: 'available'
    }
  }
}

function passJustBecameMemberLoss(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 9, total: 10, passed: true },
    member: {
      rankBefore: 'blaze',
      rankAfter: 'fresh',
      justBecameMember: true,
      gamesInRank: 0,
      gamesPerRank: 2,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 2000,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetExcluding(userTicket),
      ticketDistance: 7,            // close-call near-miss
      won: false
    },
    // See note in passJustBecameMemberWin — same fields required for
    // the suffix-drop ceremony to play.
    usernameClaim: {
      eligible: true,
      suggestedUsername: 'byteboro',
      previousUsername: 'byteboro.42',
      availability: 'available'
    }
  }
}

// Existing member who passed and WON the draw.
function memberWin(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 7, total: 10, passed: true },
    member: {
      rankBefore: 'regular',
      rankAfter: 'regular',
      justBecameMember: false,
      gamesInRank: 5,
      gamesPerRank: 8,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetIncluding(userTicket),
      ticketDistance: 0,
      won: true
    },
    usernameClaim: { eligible: false }   // already has a claimed handle
  }
}

// Existing member who passed and LOST the draw. ticketDistance
// is webview-simulated from the userTicket hash (see
// src/draw/ticketDistance.ts), so the value here is unused for the
// visual — it just needs to be a plausible non-zero value to satisfy
// the contract.
function memberLose(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 7, total: 10, passed: true },
    member: {
      rankBefore: 'regular',
      rankAfter: 'regular',
      justBecameMember: false,
      gamesInRank: 5,
      gamesPerRank: 8,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetExcluding(userTicket),
      ticketDistance: 1,    // any non-zero value; webview simulates the real one
      won: false
    },
    usernameClaim: { eligible: false }
  }
}

// Existing member who FAILED the game. Members keep their rank on
// failure (no demotion), but they lose draw eligibility for that game
// (per the passed → draw invariant) and only receive partial cards
// via the NFT reveal.
function memberFail(): GameResultsInput {
  return {
    attestations: { score: 3, total: 10, passed: false },
    member: {
      rankBefore: 'regular',
      rankAfter: 'regular',
      justBecameMember: false,
      gamesInRank: 5,
      gamesPerRank: 8,
      displayName: 'BYTEBORO'
    },
    prizeDraw: null,    // failed → no draw, per invariant
    usernameClaim: { eligible: false }
  }
}

function passFirstEver(): GameResultsInput {
  return {
    attestations: { score: 7, total: 10, passed: true },
    member: {
      rankBefore: null,
      rankAfter: 'spark',
      justBecameMember: false,
      gamesInRank: 1,
      gamesPerRank: 6
    },
    prizeDraw: null,
    usernameClaim: { eligible: false }
  }
}

// Candidate-tier failure — the user was on a candidate tier (e.g., Fire)
// and failed the game. There is NO downranking: failing wipes ALL
// candidate progression to nothing. `rankAfter` is null, `gamesInRank`
// is 0. The user must start completely over (as if they had never
// played).
function candidateFail(): GameResultsInput {
  return {
    attestations: { score: 3, total: 10, passed: false },
    member: {
      rankBefore: 'fire',
      rankAfter: null,
      justBecameMember: false,
      gamesInRank: 0,
      gamesPerRank: 6,
      displayName: 'BYTEBORO'
    },
    prizeDraw: null,
    usernameClaim: { eligible: false }
  }
}

// Skunk (0/10) at a candidate tier — same outcome as any other
// candidate-tier failure: total wipe to nothing.
function skunk(): GameResultsInput {
  return {
    attestations: { score: 0, total: 10, passed: false },
    member: {
      rankBefore: 'fire',
      rankAfter: null,
      justBecameMember: false,
      gamesInRank: 0,
      gamesPerRank: 6,
      displayName: 'BYTEBORO'
    },
    prizeDraw: null,
    usernameClaim: { eligible: false }
  }
}

// New member, but their suggested username is already taken. Native
// includes both `availability: 'taken'` AND `alternatives` in the
// initial input — webview renders the TakenVariant immediately.
function passJustBecameMemberNameTaken(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 8, total: 10, passed: true },
    member: {
      rankBefore: 'blaze',
      rankAfter: 'fresh',
      justBecameMember: true,
      gamesInRank: 0,
      gamesPerRank: 2,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetIncluding(userTicket),
      ticketDistance: 0,
      won: true
    },
    usernameClaim: {
      eligible: true,
      suggestedUsername: 'byteboro',
      previousUsername: 'byteboro.42',
      availability: 'taken',
      alternatives: ['byteboro1', 'byteboro_42', 'byteboroo', 'realbyteboro']
    }
  }
}

// New member, availability unknown. Webview falls back to the
// CautiousVariant — no name shown, no suffix-drop ceremony.
function passJustBecameMemberUnknown(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 8, total: 10, passed: true },
    member: {
      rankBefore: 'blaze',
      rankAfter: 'fresh',
      justBecameMember: true,
      gamesInRank: 0,
      gamesPerRank: 2,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetIncluding(userTicket),
      ticketDistance: 0,
      won: true
    },
    usernameClaim: {
      eligible: true,
      suggestedUsername: 'byteboro',
      previousUsername: 'byteboro.42',
      availability: 'unknown'
    }
  }
}

// New member, native did NOT include availability in the initial input
// — the user must use the dev panel's availability controls to push a
// value via setUsernameAvailability.
function passJustBecameMemberAsyncAvailability(): GameResultsInput {
  const userTicket = random32ByteHex()
  return {
    attestations: { score: 8, total: 10, passed: true },
    member: {
      rankBefore: 'blaze',
      rankAfter: 'fresh',
      justBecameMember: true,
      gamesInRank: 0,
      gamesPerRank: 2,
      displayName: 'BYTEBORO'
    },
    prizeDraw: {
      prizeUsd: 200,
      totalEntries: MOCK_TOTAL_ENTRIES,
      nextDrawAt: nextDrawIso(),
      userTicket,
      winningTickets: winningSetIncluding(userTicket),
      ticketDistance: 0,
      won: true
    },
    // availability + alternatives intentionally omitted.
    usernameClaim: {
      eligible: true,
      suggestedUsername: 'byteboro',
      previousUsername: 'byteboro.42'
    }
  }
}

// (Removed `passNoPrizeNewMember`: it modeled "new member who passed
// but received no draw this game", which violates the
// passed+member → draw invariant. Such a state shouldn't arise from
// native, so there's no need to exercise the path.)

// Reference to randomWinningSet to silence "unused" lints if all
// mocks happen to use the helpers above. Keep available for future
// mocks that want a fully-random winning set unrelated to the user.
void randomWinningSet

export const DEV_MOCKS: Array<{ label: string; build: () => GameResultsInput }> = [
  // Existing-member paths (the most common production cases).
  { label: 'member + won',                    build: memberWin },
  { label: 'member + lost',                   build: memberLose },
  { label: 'member + failed',                 build: memberFail },
  // Membership-transition paths (justBecameMember = true). The four
  // variants exercise the four UsernameClaim availability states.
  { label: 'new member + won',                build: passJustBecameMemberWin },
  { label: 'new member + lost',               build: passJustBecameMemberLoss },
  { label: 'new member + name taken',         build: passJustBecameMemberNameTaken },
  { label: 'new member + unknown avail',      build: passJustBecameMemberUnknown },
  { label: 'new member + async avail',        build: passJustBecameMemberAsyncAvailability },
  // Candidate paths (passed candidates don't get the draw —
  // it's a members-only benefit; see NATIVE_SPEC §3.3).
  { label: 'first ever (candidate)',          build: passFirstEver },
  { label: 'candidate failed (3/10)',         build: candidateFail },
  // Skunk — anyone with score 0.
  { label: 'skunk (0/10)',                    build: skunk }
]
