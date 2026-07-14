# Event-exclusive collectible tiers (how the Web3 Summit stickers worked)

For Web3 Summit 2026 the catalogue carried 14 event-exclusive "sticker" items
with their own rarity tier, a per-game "every game grants a sticker" guarantee,
and a special reveal treatment. The event ended and the whole feature was
removed in July 2026 — the full implementation lives in git history (search the
log for `STICKER_THRESHOLD`, `stickerUrlFor`, or `CATALOGUE_HAS_STICKERS`).
This note records the design so a future event tier can be rebuilt without
rediscovering the sharp edges.

## The three systems that must agree

An attestation hash is resolved to an image **independently** in three places.
They must implement byte-identical rules or the same on-chain hash shows
different art in different surfaces:

1. **The minting layer** (native / backend) — crafts attestation hashes.
2. **This repo's resolver** (`src/attestations/resolver.ts`) — the reveal.
3. **collectibles-webview's resolver** — the Pocket, where items live forever.

Any band constant, pool-classification rule, or promotion rule added here must
land in all three (the minting layer only needs the band layout, not the
pools).

## How the tier worked

**Catalogue.** Event items were ordinary `cid_map.json` entries whose filename
category segment named the tier: `00001--Stickers--agentic_human--w3s--8F5E4F.webp`.
The resolver classified keys into pools by that segment (category `Stickers`,
equivalently the `w3s` tag) — giving the tier **its own pool**, disjoint from
rare/normal.

**Rarity band.** Hash bytes 0–1 are a uint16 rarity roll checked low→high.
The event tier carved a band out **below** the rare band:

```
[0, STICKER_THRESHOLD)                            → sticker pool   (1311/65536 ≈ 2%)
[STICKER_THRESHOLD, STICKER_THRESHOLD + 6554)     → rare pool      (≈ 10%)
else                                              → normal pool
```

Bytes 2–3 then pick `pickVal % pool.length` over the lexicographically-sorted
pool, same as today. An empty pool's band fell through to the next tier, so
the same code shipped safely with or without event items bundled
(`CATALOGUE_HAS_STICKERS` gated all the extra work).

**Per-game guarantee.** "Every game grants a sticker" was delivered at
*presentation time*, because minted hashes can't be changed after the fact:
once the attestation stream settled, if no card had rolled a sticker
organically, the card with the **lexicographically-smallest hash** was
re-resolved with a `forceSticker` flag that overrode the rarity roll (bytes
2–3 still picked *which* sticker). Because the choice is a pure function of
the batch's hashes, the Pocket applied the same rule to the same mint batch
and promoted the same hash — no coordination channel needed.

**Reveal treatment.** The resolver returned an `isSticker` flag, threaded
through `CardData` in `Stage.tsx` to render a pink `★ STICKER` pill
(`.card-name-sticker` in `styles.css`) above the card name.

## Re-implementation checklist

- `src/attestations/resolver.ts`
  - Add the tier threshold constant and the band check *below* the rare band
    (bands are checked low→high; keep the empty-pool fall-through).
  - Classify the tier's keys into their own pool in `buildPoolKeys()` (match
    on the filename category segment).
  - Export a `CATALOGUE_HAS_<TIER>` flag so downstream work self-disables
    when no event items are bundled.
  - Add `is<Tier>` to `ResolvedAttestation`; add the `force<Tier>` override
    param; add the synchronous `<tier>UrlFor(hash)` helper (the album-pages
    source needs the promoted URL without re-resolving async).
- `src/components/Stage.tsx`
  - Thread `is<Tier>` through `CardData` / `emptyCard` / the resolve handler.
  - Settle-time promotion effect: after `streamSettled`, if no organic tier
    item, promote the smallest-hash card — prefer an unrevealed card, fall
    back to a stored one (single-attestation games settle after the card is
    already shelved); pre-decode the new image before swapping `badgeSrc`;
    if the card was stored, also swap its entry in `filled` so the shelf and
    the album-close fly show the promoted art; guard with a run-once ref and
    never mutate mid-flip (`seqPhase === 'revealing'`).
  - The badge pill in the card-name label.
- `src/App.tsx` — the album-pages accumulator must apply the **same**
  promotion rule (via `<tier>UrlFor`), or a promoted badge flies into the
  book and lands on its pre-promotion art.
- `src/styles.css` — the badge pill style (the sticker one was a
  Polkadot-pink gradient pill, distinct from the gold rare treatment).
- `cid_map.json` — add the event entries with the tier's category segment in
  the filename. Mirror everything in collectibles-webview + the minting layer.

## Gotchas

- **Adding catalogue entries remaps hashes** unless the new entries land in
  their own pool: pools are sorted key lists and a hash picks
  `pickVal % pool.length`, so changing a pool's membership changes what
  existing hashes resolve to. A dedicated category segment (its own pool) is
  what made both adding *and* later removing the sticker entries safe for the
  normal/rare pools.
- **Removing the tier shifts the bands.** With the sticker band gone, rolls
  in the old `[0, 1311)` band now resolve rare, and `[6554, 7865)` moved from
  rare to normal. That's inherent to retiring a tier — schedule the removal in
  this repo, collectibles-webview, and the minting layer together.
- The guarantee promotion is best-effort UI: if the forced re-resolve fails,
  the organic art stands. Don't make game logic depend on it.
- Test fixture: a stickers-only `cid_map` swap-in
  (`cid_map.json.sticktest.json`, also in git history) made the organic-roll
  path easy to exercise, since a 2% band rarely fires in manual testing.
