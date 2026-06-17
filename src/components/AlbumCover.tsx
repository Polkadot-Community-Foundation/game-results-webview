// AlbumCover — the collectibles album cover. Uses the designer's pre-baked
// COLOR cover artwork (the dark card with the "Collectibles" title and the full
// sticker collage, sourced from the iOS Pocket's collectibles card), filling
// the closed-book face. Previously this composed the individual B&W stickers in
// code; the single color render replaces that.

export default function AlbumCover() {
  return (
    <div className="album-cover-art" aria-hidden="true">
      <img className="album-cover-art-img" src="./assets/album-cover.webp" alt="" draggable={false} />
    </div>
  )
}
