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

// Rarity roll over the uint16 space (0..65535), read from bytes 0-1:
//   [0, RARE_THRESHOLD) → rare pool
//   else                → normal pool
// This constant + the pool partition MUST stay identical to
// collectibles-webview's resolver, or the reveal and the Pocket would resolve
// the same on-chain hash to different images.
//
// Event-exclusive tiers (like the retired Web3-Summit "sticker" items) slot in
// as an extra band carved out below the rare band — read
// docs/event-exclusive-collectibles.md before adding one.

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
 *    "00115--Animals--Cicada--Common--766957.webp"  → { collection: "Animals", name: "Cicada" }
 *    "00120--Animals--red_panda--Rare--C24A2F.webp" → { collection: "Animals", name: "Red Panda" }
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

/** Classify catalogue keys into sorted rare/normal pools at load —
 *  cheap (no URL strings, no name regexes, no per-entry objects), skipping
 *  entries whose CID is missing/empty so pool sizes match exactly. The
 *  mapping needs the full ordered, classified catalogue (a hash picks
 *  `pickVal % pool.length` over the sorted pool, so dropping entries
 *  would remap every hash), but the heavy per-entry materialization is
 *  deferred to `materialize()`. */
function buildPoolKeys(): { normal: string[]; rare: string[] } {
  const normal: string[] = []
  const rare: string[] = []
  for (const key of Object.keys(MAP).sort()) {
    const cid = MAP[key]
    if (typeof cid !== 'string' || !cid) continue
    // Filename is the trailing path component; tolerate both / and \.
    const filename = key.replace(/\\/g, '/').split('/').pop() || key
    if (filename.toLowerCase().includes('rare')) rare.push(key)
    else normal.push(key)
  }
  return { normal, rare }
}

const { normal: NORMAL_KEYS, rare: RARE_KEYS } = buildPoolKeys()

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
 *  __ASSET_FAILURES__; this function only handles HASH-PARSE failures. */
export function resolveAttestationAsset(hashHex: string): Promise<ResolvedAttestation> {
  const cleaned = (hashHex || '').trim()
  const hex = cleaned.startsWith('0x') || cleaned.startsWith('0X')
    ? cleaned.slice(2)
    : cleaned

  // Validate: exactly 64 hex chars (32 bytes).
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    // Fall back to the first available entry. This shouldn't happen in
    // production (native always sends valid 32-byte hashes), but we
    // don't want one malformed hash to nuke the whole shelf.
    const fallbackKey = NORMAL_KEYS[0] ?? RARE_KEYS[0]
    if (!fallbackKey) {
      return Promise.reject(new Error('cid_map is empty'))
    }
    console.warn(
      `[resolver] hash not 32-byte hex (got ${hex.length} chars), using fallback`,
      hashHex.slice(0, 16)
    )
    return Promise.resolve({ ...materialize(fallbackKey), isRare: false })
  }

  const rarityVal = uint16At(hex, 0)
  const pickVal = uint16At(hex, 2)

  // Rare band checked first (see the RARE_THRESHOLD comment). An empty rare
  // pool falls through to normal. MUST match collectibles-webview.
  let pool: string[]
  let isRare = false
  if (RARE_KEYS.length > 0 && rarityVal < RARE_THRESHOLD) {
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
  return Promise.resolve({ ...entry, isRare })
}
