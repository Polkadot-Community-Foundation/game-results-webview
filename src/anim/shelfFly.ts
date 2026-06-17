// One collectible captured from the reveal shelf at the moment the reveal
// completes — its image plus its on-screen rect (viewport coordinates from
// getBoundingClientRect). AlbumClose flies a clone from this rect into the
// matching album page cell so the same asset visibly carries from the shelf
// into the book (shared-element / "magic move" continuity).
export interface ShelfFlyItem {
  src: string
  left: number
  top: number
  width: number
  height: number
}
