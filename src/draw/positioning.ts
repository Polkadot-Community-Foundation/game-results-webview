// Pure geometry for the perspective lane scene. No DOM, no React, no
// GSAP — just deterministic math turning bridge-contract values into
// lane positions.
//
// Coordinate system (matches the ticket-three prototype):
//   x: -130 (left lane), 0 (middle), +130 (right lane)
//   y: 0 at the band's front row; more negative = further back
//   units: arbitrary "lane space" — consumed by the CSS rotateX(62deg)
//          transform in LaneScene to project into screen space
//
// The winning band always sits in the same place. The user's ticket
// position is a continuous function of ticketDistance. Anonymous filler
// tickets are sampled to convey crowd density without rendering one
// ticket per pool entry (we'd never render 1337 of them).

import type { LanePosition } from './types'

export const LANES = 3
export const LANE_X = [-130, 0, 130] as const

// Row spacing along the lane axis. Ticket height (180) < row spacing
// (200) so tickets in the same lane never overlap.
export const ROW_SPACING = 200
export const TICKET_HEIGHT = 180

// Winning band starts at Y=0 (closest to camera) and stretches BACK.
export const WINNER_FRONT_Y = 0

// Brick stagger — the middle lane offsets by half a row so the grid
// doesn't read as a uniform matrix. left/right share the same Y values.
export function laneStagger(lane: 0 | 1 | 2): number {
  return lane === 1 ? -ROW_SPACING / 2 : 0
}

/** Compute the number of rows needed to seat `winnerCount` winners
 *  across 3 lanes. Tail row may be partial. */
export function winnerRowCount(winnerCount: number): number {
  return Math.max(1, Math.ceil(winnerCount / LANES))
}

/** Y position of the back row of the winning band (most negative). */
export function winnerBackY(winnerCount: number): number {
  return WINNER_FRONT_Y - (winnerRowCount(winnerCount) - 1) * ROW_SPACING
}

/** Generate positions for the winning band. Fills lane-by-lane,
 *  front-to-back, leaving any tail-row slots blank. The user's
 *  winning ticket gets one of these slots when `won === true`. */
export function getWinnerPositions(winnerCount: number): LanePosition[] {
  const out: LanePosition[] = []
  const rows = winnerRowCount(winnerCount)
  let placed = 0
  for (let r = 0; r < rows && placed < winnerCount; r++) {
    for (let lane = 0 as 0 | 1 | 2; lane < LANES && placed < winnerCount; lane = (lane + 1) as 0 | 1 | 2) {
      const baseY = WINNER_FRONT_Y - r * ROW_SPACING
      out.push({ lane, y: baseY + laneStagger(lane), row: r })
      placed++
    }
  }
  return out
}

// User-position scale: how many Y units of lane space per unit of
// ticketDistance. Tuned so:
//   distance=7   → user sits just behind the band (no overlap)
//   distance=50  → user ~700 Y behind band (one+ rows of breathing room)
//   distance=500 → user ~1600 Y behind band (well back)
//   distance=10k+ → user very far back, cinematic long scroll
//
// Distance is reflected BOTH in lane position (spatial) AND in the
// post-cascade counter (numerical). The two cues reinforce each other:
// the camera scrolls back through the procession during the counter
// tick, so visual length + counter value resolve in lockstep at the
// user's true position. "34,000 behind" matches what the user just
// watched the camera travel through.
const USER_Y_PER_DISTANCE = 2

/** Minimum Y offset from the back of the winning band to the user's
 *  ticket on a loss — prevents the back-row middle-lane winner (at
 *  bandBack + laneStagger(1) = bandBack-100) from overlapping the user
 *  on a near-loss. Three rows of breathing room (600 Y units) keeps
 *  the band and user visually distinct. */
const MIN_USER_BEHIND_BAND = 600

/** Cap on the lane-space offset ticketDistance can add behind the band. An
 *  enormous pool (or a real chain ticketDistance in the millions) would
 *  otherwise drive the user's Y to millions of lane units — and the middle
 *  tile-bg div spans that whole gap, producing a multi-million-px element.
 *  The camera scroll-back length is already clamped to its max (~3.5s) well
 *  before this, so depth beyond the cap was never visible anyway. */
const MAX_USER_DISTANCE_Y = 12_000

/** Y position of the user's ticket on a loss. Lane is always 1
 *  (middle) so the camera can keep the user centered. Y scales with
 *  ticketDistance (clamped, see MAX_USER_DISTANCE_Y) so the spatial layout
 *  reflects how far the user was without exploding the tile-bg size. */
export function getUserLossPosition(ticketDistance: number, winnerCount: number): LanePosition {
  const back = winnerBackY(winnerCount)
  const lane = 1 as const
  const y =
    back + laneStagger(lane)
    - MIN_USER_BEHIND_BAND
    - Math.min(MAX_USER_DISTANCE_Y, Math.max(0, ticketDistance) * USER_Y_PER_DISTANCE)
  return { lane, y }
}

/** When the user WINS, they occupy one of the winning-band positions.
 *  We pick the middle-row, middle-lane position so the lift animation
 *  rises from screen center. */
export function getUserWinPosition(winnerCount: number): LanePosition {
  const winners = getWinnerPositions(winnerCount)
  const middle = winners[Math.floor(winners.length / 2)]
  return middle ?? { lane: 1, y: 0 }
}

/** Real DOM anons spawned in the two FOCAL ZONES — immediately behind
 *  the band and around the user. Six rows each, at natural ROW_SPACING.
 *  Total real anon ticket DOM = (2 front + 6 back + 6 user) × 3 lanes
 *  = ~42 elements regardless of user distance.
 *
 *  The long MIDDLE stretch (between the back-band zone and the user
 *  zone) is rendered as a tiled background image instead — see
 *  `getMiddleTileBounds`. Camera scrolls past the tile too fast for
 *  the user to perceive that individual tickets aren't real DOM. */
const DENSE_BAND_ROWS = 6
const DENSE_USER_ROWS_AHEAD = 4    // rows between user and the tile (towards band)
const DENSE_USER_ROWS_BEHIND = 2   // rows beyond user

/** Y range (in lane coords) where the tiled-background "ghost
 *  procession" should be rendered. The Y values are the CSS edges of
 *  the div (after the lane-Y → CSS translate):
 *
 *    topEdgeY    - more negative; CSS top edge of div; the "user side"
 *                  end of the tile zone. The first background tile in
 *                  the repeat-y sequence sits here, with its CENTER at
 *                  topEdgeY + ROW_SPACING/2 — which is set to be the
 *                  row position immediately band-ward of the dense
 *                  user zone (i.e., the next row in the rhythm).
 *
 *    bottomEdgeY - less negative; CSS bottom edge of div; the "band
 *                  side" end. The last tile's center sits at
 *                  bottomEdgeY - ROW_SPACING/2 — the row position
 *                  immediately user-ward of the dense back-band zone.
 *
 *  Result: tile centers form a continuous row grid abutting the real
 *  dense-zone tickets at both ends, with no extra gaps and matching
 *  ROW_SPACING throughout.
 *
 *  Returns null when the user is so close to the band that there's no
 *  room for a tile gap — short losses get the dense zones to overlap
 *  into one continuous strip. */
export interface MiddleTileBounds {
  topEdgeY: number
  bottomEdgeY: number
}

/** Lowest Y (most-negative) of the dense-back zone — used both by
 *  getAnonPositions and getMiddleTileBounds so they stay in sync. */
function denseBackEndY(winnerCount: number): number {
  return winnerBackY(winnerCount) - DENSE_BAND_ROWS * ROW_SPACING
}

/** Snap a Y value to the band's row grid (i.e., the nearest multiple
 *  of ROW_SPACING from WINNER_FRONT_Y). Lane stagger is applied later
 *  per-lane so the grid itself is lane-agnostic. */
function snapToBandGrid(y: number): number {
  return Math.round((y - WINNER_FRONT_Y) / ROW_SPACING) * ROW_SPACING + WINNER_FRONT_Y
}

/** Highest Y (least-negative) of the dense-user zone. Anchored to the
 *  band's row grid so the dense-user rows always align with dense-back
 *  rows + tile-bg rows (one consistent 200-unit rhythm everywhere). */
function denseUserTopY(userY: number): number {
  return snapToBandGrid(userY) + DENSE_USER_ROWS_AHEAD * ROW_SPACING
}

/** Generate dense anonymous-ticket positions in the focal zones.
 *
 *  Two zones merged by dedupe so every distance produces continuous
 *  row coverage:
 *    - dense-back: 6 rows immediately behind the band
 *    - dense-user: 4 rows ahead of user + 2 behind, anchored to the
 *      band's row grid so rows always land on multiples of ROW_SPACING
 *      from bandBack (alignment with tile-bg + dense-back).
 *
 *  For short losses both zones overlap; dedupe keeps unique positions
 *  so coverage is continuous from bandBack-1*ROW down past the user.
 *  For long losses there's a gap which getMiddleTileBounds fills with
 *  tile-bg. */
export function getAnonPositions(
  userY: number,
  winnerCount: number
): LanePosition[] {
  // Dedupe across the two zones via a string key per (lane, rounded Y).
  const seen = new Set<string>()
  const out: LanePosition[] = []
  function pushOnce(lane: 0 | 1 | 2, y: number) {
    const key = `${lane}|${Math.round(y)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ lane, y })
  }

  const bandFront = WINNER_FRONT_Y
  const bandBack = winnerBackY(winnerCount)
  const userGridY = snapToBandGrid(userY)

  // 1) Two rows IN FRONT of the band (always 6 anons here).
  for (let r = 1; r <= 2; r++) {
    const baseY = bandFront + r * ROW_SPACING
    for (let lane = 0 as 0 | 1 | 2; lane < LANES; lane = (lane + 1) as 0 | 1 | 2) {
      pushOnce(lane, baseY + laneStagger(lane))
    }
  }

  // 2) Dense rows BEHIND the band (rows 1..DENSE_BAND_ROWS).
  for (let r = 1; r <= DENSE_BAND_ROWS; r++) {
    const y = bandBack - r * ROW_SPACING
    for (let lane = 0 as 0 | 1 | 2; lane < LANES; lane = (lane + 1) as 0 | 1 | 2) {
      pushOnce(lane, y + laneStagger(lane))
    }
  }

  // 3) Dense rows AROUND the user, anchored to the band's row grid so
  //    they line up with the band rows + tile-bg rows. Always added;
  //    overlap with the dense-back-zone is handled by `pushOnce`'s
  //    dedupe.
  for (let r = -DENSE_USER_ROWS_BEHIND; r <= DENSE_USER_ROWS_AHEAD; r++) {
    const y = userGridY + r * ROW_SPACING
    for (let lane = 0 as 0 | 1 | 2; lane < LANES; lane = (lane + 1) as 0 | 1 | 2) {
      pushOnce(lane, y + laneStagger(lane))
    }
  }

  return out
}

/** Return the Y span where the tiled-background "ghost procession"
 *  should render, or null if the dense zones already overlap (short
 *  losses don't need a tile — the dense rows cover everything).
 *
 *  Math: tile background uses `background-size: 80px ROW_SPACING` with
 *  `repeat-y`. Each tile in the repeat sequence is ROW_SPACING tall
 *  and shows one ticket centered. We position the div's CSS top edge
 *  half a row above the FIRST row we want to render, and its bottom
 *  edge half a row below the LAST row. This makes the tile center
 *  positions land EXACTLY on the same row grid as the real dense-zone
 *  tickets (no extra gaps, no misalignment). */
export function getMiddleTileBounds(
  userY: number,
  winnerCount: number
): MiddleTileBounds | null {
  const backEnd = denseBackEndY(winnerCount)
  const userTop = denseUserTopY(userY)
  // First row position in the tile zone, immediately user-ward of the
  // dense back-band zone (one ROW_SPACING deeper than the dense-back
  // zone's deepest row).
  const firstRowFromBand = backEnd - ROW_SPACING
  // First row position in the tile zone, immediately band-ward of the
  // dense user zone (one ROW_SPACING shallower than the dense-user
  // zone's shallowest row).
  const firstRowFromUser = userTop + ROW_SPACING

  // Need at least one row between them. firstRowFromBand is the
  // band-side bound (less negative); firstRowFromUser is the user-side
  // bound (more negative). For there to be a gap, the band-side bound
  // must be LESS negative than the user-side bound (i.e., greater).
  // If they cross or coincide, the dense zones already overlap → no
  // tile needed.
  if (firstRowFromBand <= firstRowFromUser) return null

  return {
    // CSS top of div = half a row above firstRowFromUser, so the first
    // background tile's center lands EXACTLY on firstRowFromUser.
    topEdgeY: firstRowFromUser - ROW_SPACING / 2,
    // CSS bottom of div = half a row below firstRowFromBand, so the
    // last background tile's center lands EXACTLY on firstRowFromBand.
    bottomEdgeY: firstRowFromBand + ROW_SPACING / 2
  }
}

/** Cut-line Y — sits at the boundary between the winning band's back
 *  row and the first non-winning row. The visual moment of "the draw
 *  passed; you're either above or below this line". */
export function cutlineY(winnerCount: number): number {
  return winnerBackY(winnerCount) - ROW_SPACING / 2
}
