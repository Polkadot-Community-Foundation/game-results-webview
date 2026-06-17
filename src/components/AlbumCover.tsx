// AlbumCover — the collectibles album cover, reproduced 1:1 from the designer's
// Figma cover (161:3677): a graphite cover with the "Collectibles" title and a
// collage of sticker artworks at their exact positions / rotations / opacities
// (as percentages of the 370.6×535.46 cover, so it scales with the closed
// album). The sticker source art is the designer's, optimized to small webps
// (the originals were ~12MB of 1024px PNGs — see public/assets/album/).

const BASE = './assets/album/'

interface Sticker {
  src: string
  cx: number // centre x, % of cover width
  cy: number // centre y, % of cover height
  w: number  // width, % of cover width (square)
  r: number  // rotation, deg
  o: number  // opacity
}

// s01 sits below the title; s02–s11 sit above it (per the Figma z-order).
const UNDER: Sticker = { src: 's01.webp', cx: 90.10, cy: 51.37, w: 31.50, r: 11.63, o: 1 }
const OVER: Sticker[] = [
  { src: 's02.webp', cx: 63.72, cy: 2.62, w: 37.71, r: -14.03, o: 0.4 },
  { src: 's03.webp', cx: 83.42, cy: 30.04, w: 46.81, r: -26.96, o: 1 },
  { src: 's04.webp', cx: 36.72, cy: 22.47, w: 50.09, r: 15.93, o: 0.4 },
  { src: 's05.webp', cx: 92.52, cy: 6.98, w: 27.55, r: -31.82, o: 0.4 },
  { src: 's06.webp', cx: 5.22, cy: 39.61, w: 42.56, r: -24.45, o: 0.5 },
  { src: 's07.webp', cx: 56.50, cy: 74.79, w: 46.87, r: -15.36, o: 1 },
  { src: 's08.webp', cx: 13.35, cy: 66.95, w: 46.87, r: 28.26, o: 1 },
  { src: 's09.webp', cx: 91.24, cy: 73.55, w: 47.13, r: 0, o: 1 },
  { src: 's10.webp', cx: 18.34, cy: 90.65, w: 58.75, r: 21.72, o: 1 },
  { src: 's11.webp', cx: 71.50, cy: 93.33, w: 40.50, r: -39.28, o: 1 },
]

function stickerStyle(s: Sticker): React.CSSProperties {
  return {
    left: `${s.cx}%`,
    top: `${s.cy}%`,
    width: `${s.w}%`,
    transform: `translate(-50%, -50%) rotate(${s.r}deg)`,
    opacity: s.o,
  }
}

export default function AlbumCover() {
  return (
    <div className="album-cover-art" aria-hidden="true">
      <img className="album-cover-art-sticker" style={stickerStyle(UNDER)} src={BASE + UNDER.src} alt="" draggable={false} />
      <span className="album-cover-art-title">Collectibles</span>
      {OVER.map((s) => (
        <img key={s.src} className="album-cover-art-sticker" style={stickerStyle(s)} src={BASE + s.src} alt="" draggable={false} />
      ))}
      <span className="album-cover-art-rim" />
    </div>
  )
}
