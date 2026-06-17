// Attestation hash → displayable asset URL + name.
//
// Ported from the CollectableHashResolver tool (~/git/CollectableHashResolver).
// Images are hosted on the Web3 Summit IPFS gateway and indexed by CID in
// `cid_map.json`. The 32-byte attestation hash from native deterministically
// picks one image from the catalog:
//
//   bytes 0-1 → rarity roll (uint16; if < RARE_THRESHOLD, draw from
//                rare pool, else normal)
//   bytes 2-3 → image index (uint16; mod pool size → entry in the
//                lexicographically-sorted pool)
//
// The collection is split at module load into a "normal" pool and a
// "rare" pool by checking each filename for the substring "rare"
// (case-insensitive). Sorting is by full path key, lexicographic, so
// new images appended with later 5-digit prefixes never remap existing
// hashes.
//
// Only the catalogue KEYS are classified at load (cheap). The URL + the
// human display name for an entry are materialized lazily and memoized,
// so we only ever build them for entries the user actually receives —
// O(owned) work instead of O(catalogue), which matters as the catalogue
// grows. (Mirrors collectibles-webview's resolver.)
//
// resolveAttestationAsset stays ASYNC (returns a Promise): Stage.tsx and
// the image prefetch consume it via .then(), and a production version may
// later need to verify the gateway / warm the cache.
//
// IPFS gateway: the Web3 Summit gateway. Images live there; the
// URL goes straight into an <img> src. Gateway / CID failures surface as
// image load errors in Stage.tsx (which counts them via __ASSET_FAILURES__
// for the post-session flow.error event).

import cidMap from './cid_map.json'

/** Web3 Summit IPFS gateway. Serves catalogue images at `/ipfs/<cid>`. */
const IPFS_GATEWAY = 'https://summit-ipfs.polkadot.io/ipfs'

// Rarity-roll bands over the uint16 space (0..65535), read from bytes 0-1 and
// checked low→high:
//   [0, STICKER_THRESHOLD)                              → sticker pool
//   [STICKER_THRESHOLD, STICKER_THRESHOLD+RARE_BAND)    → rare pool
//   else                                                 → normal pool
// The "stickers" are the 14 Web3-Summit ("w3s") promo items — a special tier
// of their own. The per-GAME guarantee ("always 1 sticker") is delivered by
// the minting layer crafting one attestation hash per game whose rarity bytes
// fall in [0, STICKER_THRESHOLD); this resolver only maps that band to the
// sticker pool deterministically. These constants + the pool partition MUST
// stay identical to collectibles-webview's resolver, or the reveal and the
// Pocket would resolve the same on-chain hash to different images.

/** Sticker band width. ≈ 1311/65536 ≈ 2% organic sticker chance. */
const STICKER_THRESHOLD = 1311
/** Rare band width. 6554/65536 ≈ 10%. Matches RARE_THRESHOLD in
 *  CollectableHashResolver/resolver.py. */
const RARE_THRESHOLD = 6554

const MAP = cidMap as Record<string, string>

/** Title-case a separator-delimited fragment: "_"/"-" → spaces, collapse
 *  whitespace, capitalise each word. */
function titleCase(fragment: string): string {
  return fragment
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Split a catalogue filename into the collection it belongs to and the
 *  item's own name. The catalogue key format is
 *    "INDEX--Category--name--tag--HEX.webp"
 *  Surfacing collection + name separately keeps the collection out of every
 *  item name — it's shown as its own eyebrow instead.
 *    "00001--Stickers--agentic_human--w3s--8F5E4F.webp" → { collection: "Stickers", name: "Agentic Human" }
 *    "00120--Animals--red_panda--Rare--C24A2F.webp"     → { collection: "Animals",  name: "Red Panda" }
 *  The leading index, the rarity/tag segment (second-to-last) and the hex
 *  (last) are dropped from the name. A filename that doesn't fit the `--`
 *  shape falls back to treating the whole basename (minus a numeric index) as
 *  the name with no collection. */
function parseName(filename: string): { collection: string; name: string } {
  const base = filename.replace(/\.[a-z0-9]+$/i, '')   // drop extension
  const parts = base.split('--')
  if (parts.length < 4) {
    return { collection: '', name: titleCase(base.replace(/^\d+[_-]/, '')) }
  }
  const collection = titleCase(parts[1] ?? '')
  // Name is everything between the category (index 1) and the trailing
  // tag + hex (the last two segments).
  const name = titleCase(parts.slice(2, parts.length - 2).join(' '))
  return { collection, name: name || collection }
}

/** True for the 14 special "sticker" items — identified by the catalogue
 *  category segment being "Stickers" (equivalently the "w3s" tag). They get
 *  their own pool, distinct from rare/normal. */
function isStickerFilename(filename: string): boolean {
  const base = filename.replace(/\.[a-z0-9]+$/i, '')
  const parts = base.split('--')
  return (parts[1] ?? '').toLowerCase() === 'stickers'
}

/** Classify catalogue keys into sorted sticker/rare/normal pools at load —
 *  cheap (no URL strings, no name regexes, no per-entry objects), skipping
 *  entries whose CID is missing/empty so pool sizes match exactly. The
 *  mapping needs the full ordered, classified catalogue (a hash picks
 *  `pickVal % pool.length` over the sorted pool, so dropping entries
 *  would remap every hash), but the heavy per-entry materialization is
 *  deferred to `materialize()`. */
function buildPoolKeys(): { normal: string[]; rare: string[]; sticker: string[] } {
  const normal: string[] = []
  const rare: string[] = []
  const sticker: string[] = []
  for (const key of Object.keys(MAP).sort()) {
    const cid = MAP[key]
    if (typeof cid !== 'string' || !cid) continue
    // Filename is the trailing path component; tolerate both / and \.
    const filename = key.replace(/\\/g, '/').split('/').pop() || key
    if (isStickerFilename(filename)) sticker.push(key)
    else if (filename.toLowerCase().includes('rare')) rare.push(key)
    else normal.push(key)
  }
  return { normal, rare, sticker }
}

const { normal: NORMAL_KEYS, rare: RARE_KEYS, sticker: STICKER_KEYS } = buildPoolKeys()

/** Whether the bundled catalogue contains any sticker items — lets the reveal
 *  skip the per-game sticker-guarantee work when there are none. */
export const CATALOGUE_HAS_STICKERS = STICKER_KEYS.length > 0

interface MaterializedEntry {
  url: string
  filename: string
  name: string
  collection: string
}

/** Lazily build (and memoize) the URL + display name for a catalogue
 *  key. Only ever called for entries the user actually receives (and the
 *  malformed-hash fallback), so a growing catalogue doesn't add startup
 *  work. */
const entryCache = new Map<string, MaterializedEntry>()
function materialize(key: string): MaterializedEntry {
  let entry = entryCache.get(key)
  if (entry) return entry
  const filename = key.replace(/\\/g, '/').split('/').pop() || key
  const { collection, name } = parseName(filename)
  entry = {
    url: `${IPFS_GATEWAY}/${MAP[key]}`,
    filename,
    name,
    collection
  }
  entryCache.set(key, entry)
  return entry
}

export interface ResolvedAttestation {
  /** IPFS gateway URL — ready to drop into an <img src>. */
  url: string
  /** Original filename from cid_map (e.g. "00003_Black_Opal_rare.png").
   *  Useful for diagnostic logs. */
  filename: string
  /** Item display name with the collection prefix removed, e.g.
   *  "Aperol Spritz". Shown on the revealed card. */
  name: string
  /** The collection the item belongs to, e.g. "Cocktail" (the first
   *  filename token). Shown as an eyebrow above the name; '' when the
   *  filename has no collection prefix. */
  collection: string
  /** True iff the hash resolved to the rare pool. The webview uses this
   *  to drive card-art selection (high-value art vs generic) — see
   *  Stage.tsx. */
  isRare: boolean
  /** True iff the hash resolved to the special "sticker" pool (the 14
   *  Web3-Summit items). Drives the sticker label on the revealed card. */
  isSticker: boolean
}

/** Parse a uint16 from two consecutive hex chars at the given byte
 *  offset (0 = first byte = chars [0..2)). Returns 0 if the hex is
 *  malformed (defensive — caller has already validated the overall
 *  shape). */
function uint16At(hex: string, byteOffset: number): number {
  const start = byteOffset * 2
  const hi = parseInt(hex.slice(start, start + 2), 16)
  const lo = parseInt(hex.slice(start + 2, start + 4), 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0
  return ((hi & 0xff) << 8) | (lo & 0xff)
}

/** Resolve a 32-byte attestation hash to a collectible image.
 *
 *  Accepts hex with or without a leading "0x". Returns the chosen
 *  IPFS URL + filename + display name + isRare flag. Async-return for
 *  forward-compatibility; the body is synchronous today.
 *
 *  On malformed input, falls back to the first available entry and
 *  logs a warning. Stage.tsx separately tracks IMAGE-LOAD failures via
 *  __ASSET_FAILURES__; this function only handles HASH-PARSE failures.
 *
 *  `forceSticker` overrides the rarity roll and resolves the hash into the
 *  sticker pool (the hash's index bytes still pick WHICH sticker). It backs
 *  the per-game sticker guarantee — see the settle-time promotion in
 *  Stage.tsx — and mirrors collectibles-webview's resolveCollectible so the
 *  reveal and the Pocket agree on the same promoted hash. */
export function resolveAttestationAsset(hashHex: string, forceSticker = false): Promise<ResolvedAttestation> {
  const cleaned = (hashHex || '').trim()
  const hex = cleaned.startsWith('0x') || cleaned.startsWith('0X')
    ? cleaned.slice(2)
    : cleaned

  // Validate: exactly 64 hex chars (32 bytes).
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    if (forceSticker && STICKER_KEYS.length > 0) {
      return Promise.resolve({ ...materialize(STICKER_KEYS[0]!), isRare: false, isSticker: true })
    }
    // Fall back to the first available entry. This shouldn't happen in
    // production (native always sends valid 32-byte hashes), but we
    // don't want one malformed hash to nuke the whole shelf.
    const fallbackKey = NORMAL_KEYS[0] ?? RARE_KEYS[0] ?? STICKER_KEYS[0]
    if (!fallbackKey) {
      return Promise.reject(new Error('cid_map is empty'))
    }
    console.warn(
      `[resolver] hash not 32-byte hex (got ${hex.length} chars), using fallback`,
      hashHex.slice(0, 16)
    )
    return Promise.resolve({ ...materialize(fallbackKey), isRare: false, isSticker: false })
  }

  const rarityVal = uint16At(hex, 0)
  const pickVal = uint16At(hex, 2)

  // Bands checked low→high: sticker, then rare, then normal (see the
  // STICKER_THRESHOLD / RARE_THRESHOLD comment). `forceSticker` short-circuits
  // to the sticker pool. An empty pool is skipped so its band falls through to
  // the next tier. MUST match collectibles-webview.
  let pool: string[]
  let isSticker = false
  let isRare = false
  if (forceSticker && STICKER_KEYS.length > 0) {
    pool = STICKER_KEYS
    isSticker = true
  } else if (STICKER_KEYS.length > 0 && rarityVal < STICKER_THRESHOLD) {
    pool = STICKER_KEYS
    isSticker = true
  } else if (RARE_KEYS.length > 0 && rarityVal < STICKER_THRESHOLD + RARE_THRESHOLD) {
    pool = RARE_KEYS
    isRare = true
  } else {
    pool = NORMAL_KEYS
  }
  if (pool.length === 0) {
    // The chosen pool is empty — bundled cid_map is broken.
    return Promise.reject(new Error('attestation pools are empty'))
  }

  const entry = materialize(pool[pickVal % pool.length]!)
  return Promise.resolve({ ...entry, isRare, isSticker })
}

/** Synchronous URL of the sticker a hash resolves to WHEN forced into the
 *  sticker pool (the hash's index bytes still pick which sticker). Returns ''
 *  when the catalogue has no stickers. Mirrors the `forceSticker` branch of
 *  resolveAttestationAsset so the album-pages source (App.tsx) and the reveal
 *  agree on the exact promoted image — no flash to the "other" art on the
 *  shelf→book fly. */
export function stickerUrlFor(hashHex: string): string {
  if (STICKER_KEYS.length === 0) return ''
  const cleaned = (hashHex || '').trim()
  const hex = cleaned.startsWith('0x') || cleaned.startsWith('0X') ? cleaned.slice(2) : cleaned
  const pickVal = /^[0-9a-fA-F]{64}$/.test(hex) ? uint16At(hex, 2) : 0
  return materialize(STICKER_KEYS[pickVal % STICKER_KEYS.length]!).url
}
