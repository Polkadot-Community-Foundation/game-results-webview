// AlbumCover — the collectibles album cover. Uses the designer's pre-baked
// COLOR cover artwork (the dark card with the "Collectibles" title and the full
// collectible collage, sourced from the iOS Pocket's collectibles card), filling
// the closed-book face. Previously this composed individual collectible art in
// code; the single color render replaces that.

export default function AlbumCover() {
  return (
    <div className="album-cover-art" aria-hidden="true">
      <img className="album-cover-art-img" src="./assets/album-cover.webp" alt="" draggable={false} />
    </div>
  )
}
