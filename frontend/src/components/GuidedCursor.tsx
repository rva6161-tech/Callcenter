import { useEffect, useState } from 'react'
import { dismissGuide, subscribeGuide, type GuideState } from '../lib/guide'

/**
 * Fixed overlay that visualises the guided-automation controller: an animated
 * pointer that tweens to its target, a pulsing highlight ring, and a click
 * ripple. Mounted once (in Layout) above the whole app with pointer-events
 * disabled so it can never intercept real user clicks.
 */
export default function GuidedCursor() {
  const [state, setState] = useState<GuideState | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeGuide(setState)

    // The moment the real user drives their own pointer, get the fake cursor
    // (and any ring/ripple) out of the way. The guided animation only tweens a
    // CSS transform on a DIV and never dispatches real pointer/wheel/touch
    // events, so these listeners only ever fire from genuine user input.
    const onUserInteract = () => dismissGuide()
    window.addEventListener('pointerdown', onUserInteract, { passive: true })
    window.addEventListener('pointermove', onUserInteract, { passive: true })
    window.addEventListener('wheel', onUserInteract, { passive: true })
    window.addEventListener('touchstart', onUserInteract, { passive: true })

    return () => {
      unsubscribe()
      window.removeEventListener('pointerdown', onUserInteract)
      window.removeEventListener('pointermove', onUserInteract)
      window.removeEventListener('wheel', onUserInteract)
      window.removeEventListener('touchstart', onUserInteract)
    }
  }, [])

  if (!state) return null

  const { cursor, ring, ripple } = state

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
    >
      {/* Highlight ring — keyed so each pulse restarts the animation. */}
      {ring && (
        <div
          key={`ring-${ring.key}`}
          className="absolute"
          style={{
            top: ring.top,
            left: ring.left,
            width: ring.width,
            height: ring.height,
          }}
        >
          <span className="absolute inset-0 rounded-xl ring-2 ring-indigo-500/80" />
          <span className="absolute inset-0 animate-ping rounded-xl ring-4 ring-indigo-400/60" />
        </div>
      )}

      {/* Click ripple. */}
      {ripple && (
        <span
          key={`ripple-${ripple.key}`}
          className="absolute h-10 w-10 animate-ping rounded-full bg-indigo-500/40"
          style={{
            top: ripple.y,
            left: ripple.x,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Animated cursor. */}
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) scale(${
            cursor.pressed ? 0.82 : 1
          })`,
          transition:
            'transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 200ms ease',
          opacity: cursor.visible ? 1 : 0,
        }}
      >
        <svg
          className="h-7 w-7 drop-shadow-md"
          viewBox="0 0 24 24"
          fill="none"
          style={{ transform: 'translate(-2px, -2px)' }}
        >
          <path
            d="M5 3l15 9-6.5 1.5L10 20 5 3z"
            fill="#4f46e5"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
