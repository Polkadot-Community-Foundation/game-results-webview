import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface InfoTipProps {
  title: string
  body: string
  /** Accessible label for the "?" trigger (the visible glyph is decorative). */
  label?: string
}

/** A small "?" affordance that opens a centered explanation card.
 *
 *  The overlay is PORTALED into `.phone-frame` so it always covers the device
 *  viewport — clipped to the frame in the desktop preview, full-screen when
 *  embedded — regardless of where the trigger sits in the layout (so a trigger
 *  inside a small absolutely/relatively-positioned element doesn't trap the
 *  overlay in a tiny box). Falls back to <body> if the frame isn't found. */
export default function InfoTip({ title, body, label }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const target = typeof document !== 'undefined'
    ? (document.querySelector('.phone-frame') as HTMLElement | null)
    : null

  const overlay = open ? (
    <div
      className="infotip-overlay"
      role="presentation"
      onClick={close}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="infotip-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="infotip-title">{title}</h3>
        <p className="infotip-body">{body}</p>
        <button ref={closeRef} type="button" className="infotip-close" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="infotip-trigger"
        aria-label={label ?? `What is ${title}?`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
      >
        ?
      </button>
      {overlay && (target ? createPortal(overlay, target) : overlay)}
    </>
  )
}
