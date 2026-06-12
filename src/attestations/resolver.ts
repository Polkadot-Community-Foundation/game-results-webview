// Attestation hash → displayable asset URL + name.
//
// Ported from the CollectableHashResolver tool (~/git/CollectableHashResolver).
// Images are uploaded to the Polkadot Bulletin Chain (Summit network) and
// indexed by CID in `cid_map.json`. The 32-byte attestation hash from
// native deterministically picks one image from the catalog:
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
// IPFS gateway: Summit's Bulletin gateway. Images live there; the
// URL goes straight into an <img> src. Gateway / CID failures surface as
// image load errors in Stage.tsx (which counts them via __ASSET_FAILURES__
// for the post-session flow.error event).

import cidMap from './cid_map.json'

/** Summit Bulletin Chain IPFS gateway. Bulletin storage expires
 *  (~2 weeks); when that happens, re-upload via the resolver tool. */
const IPFS_GATEWAY = 'https://summit-ipfs.polkadot.io/ipfs'

/** Rarity threshold over a uint16 space (0..65535). 6554/65536 ≈ 10%
 *  chance of a rare roll. Matches RARE_THRESHOLD in
 *  CollectableHashResolver/resolver.py. */
const RARE_THRESHOLD = 6554

const MAP = cidMap as Record<string, string>

/** Split a catalogue filename into the collection it belongs to and the
 *  item's own name. The first token of the cleaned filename is the
 *  collection (e.g. "Cocktail", "Fruit", "Geode"); the rest is the item
 *  name. Surfacing them separately keeps the collection out of every
 *  item name — it's shown as its own eyebrow instead.
 *    "00001_Cocktail_Aperol_Spritz.webp" → { collection: "Cocktail", name: "Aperol Spritz" }
 *    "00048_Geode_Opal_rare.webp"        → { collection: "Geode",    name: "Opal" }
 *    "00001_Solo.webp"                   → { collection: "",         name: "Solo" } */
function parseName(filename: string): { collection: string; name: string } {
  const cleaned = filename
    .replace(/\.[a-z0-9]+$/i, '')   // drop extension
    .replace(/^\d+[_-]/, '')         // drop leading 5-digit index
    .replace(/[_-]+/g, ' ')          // separators → spaces
    .replace(/\brare\b/gi, '')       // drop the rarity tag
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
  const words = cleaned.split(' ').filter(Boolean)
  // Only treat the first word as a collection when there's an item name
  // left after it — a lone word stays the name (no collection).
  if (words.length <= 1) return { collection: '', name: cleaned }
  return { collection: words[0]!, name: words.slice(1).join(' ') }
}

/** Classify catalogue keys into sorted normal/rare pools at load — cheap
 *  (no URL strings, no name regexes, no per-entry objects), skipping
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

  const useRare = RARE_KEYS.length > 0 && rarityVal < RARE_THRESHOLD
  const pool = useRare ? RARE_KEYS : NORMAL_KEYS
  if (pool.length === 0) {
    // Both pools empty — bundled cid_map is broken.
    return Promise.reject(new Error('attestation pools are empty'))
  }

  const entry = materialize(pool[pickVal % pool.length]!)
  return Promise.resolve({ ...entry, isRare: useRare })
}
