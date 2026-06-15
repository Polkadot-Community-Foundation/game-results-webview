import { useEffect, useMemo, useRef, useState } from 'react'
import PhoneFrame from './components/PhoneFrame'
import ChestScreen from './screens/ChestScreen'
import ResultsScreen from './screens/ResultsScreen'
import PrizeDrawScreen from './screens/PrizeDrawScreen'
import NFTRevealScreen from './screens/NFTRevealScreen'
import UsernameCTAScreen from './screens/UsernameCTAScreen'
import HandoffScreen from './screens/HandoffScreen'
import AwaitingVerdictScreen from './screens/AwaitingVerdictScreen'
import DoneScreen from './screens/DoneScreen'
import BootErrorScreen from './screens/BootErrorScreen'
import ErrorBoundary from './components/ErrorBoundary'
import { readInitialInput, subscribeInput } from './bridge/input'
import { subscribeAvailability } from './bridge/availability'
import { resetAttestations, subscribeAttestations, onShelfAttestationCount } from './bridge/attestations'
import { SHELF_SIZE } from './components/Stage'
import { subscribeOutcome, readBufferedOutcome, resetOutcome } from './bridge/outcome'
import { sendFlowEvent } from './bridge/send'
import { fetchDisplayName } from './bridge/fetchName'
import type { GameResultsInput, GameOutcome, UsernameAvailability } from './bridge/types'
import { DEV_MOCKS } from './devMocks'
import { setReducedMotionOverride } from './anim/easings'

// Dev-mode helper: simulate native streaming attestations into the webview
// after a mock is loaded, then firing setGameOutcome the way native would
// (passed → at the 6th attestation; failed → a beat after the stream ends,
// standing in for native's ~10-min timeout). Spread across STREAM_DURATION_MS
// so the realistic "still streaming in" timing gets exercised.
const STREAM_DURATION_MS = 4_500

/** Generate a realistic native-shape attestation hash: `0x` + 64
 *  lowercase hex chars (32 bytes). The CollectableHashResolver-based
 *  resolver consumes the first 4 bytes to derive rarity + image pick. */
function mockAttestationHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let h = '0x'
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
}

// If native never pushes input, the boot screen would otherwise spin
// forever. After this many ms we transition to BootErrorScreen with a
// retry button + a Close that fires flow.complete so native can dismiss.
const BOOT_TIMEOUT_MS = 30_000

// The reveal "settles" (stops waiting for more cards, enabling the finale)
// when the outcome resolves, the stream goes quiet for this long, all 10
// arrive, or an absolute cap is hit. Tunable on device — see
// STREAMING_OUTCOME_PROPOSAL.md §7.
const STALL_QUIET_MS = 9_000
const REVEAL_CAP_MS = 45_000

// After the reveal, if the outcome hasn't resolved we wait on the
// awaiting-verdict screen rather than dropping straight to the Pocket handoff.
// Collectibles arrive fast now, so a quiet reveal just means "verdict still
// landing", not "give up". Only after this (deliberately long) wait do we fall
// back to the handoff; a manual "Check your Pocket" escape appears sooner (see
// AwaitingVerdictScreen) so an impatient user is never trapped.
const AWAIT_VERDICT_TIMEOUT_MS = 120_000

type Screen =
  | 'boot' | 'boot_error' | 'chest' | 'nft_reveal' | 'results'
  | 'prize_draw' | 'username_cta' | 'awaiting_verdict' | 'handoff' | 'done'

// The collectibles reveal is the FIRST beat (after the chest) so it can
// absorb the time while attestations stream in. The outcome — pass/fail and
// everything gated on it — is NOT known upfront; it arrives via
// setGameOutcome (or is synthesized from a legacy setGameResults). So we
// always open the chest and let the reveal + outcome resolve the rest.
function firstScreen(_input: GameResultsInput): Screen {
  return 'chest'
}

/** Back-compat: a legacy "outcome-known-upfront" setGameResults still carries
 *  `attestations.passed`. Its presence lets us synthesize a GameOutcome
 *  immediately instead of waiting for setGameOutcome. Returns null for the
 *  current streaming-native shape (no upfront `passed`). */
function synthOutcome(input: GameResultsInput): GameOutcome | null {
  if (typeof input.attestations.passed !== 'boolean') return null
  return {
    passed: input.attestations.passed,
    justBecameMember: input.member.justBecameMember,
    prizeDraw: input.prizeDraw,
    usernameClaim: input.usernameClaim
  }
}

// After the reveal: the verdict if the outcome resolved, else WAIT for it on
// the awaiting-verdict screen (which only falls back to the Pocket handoff
// after a long wait).
function nextAfterReveal(outcome: GameOutcome | null): Screen {
  return outcome ? 'results' : 'awaiting_verdict'
}
function nextAfterVerdict(outcome: GameOutcome | null): Screen {
  // New members claim their username RIGHT AFTER the membership-unlocked
  // verdict; the prize draw (if any) comes after that. Everyone else with a
  // pass + prize draw goes straight to the draw; otherwise Done.
  if (outcome?.usernameClaim.eligible) return 'username_cta'
  if (outcome?.passed && outcome.prizeDraw) return 'prize_draw'
  return 'done'
}
function nextAfterUsername(outcome: GameOutcome | null): Screen {
  // The prize draw follows the username claim for new members.
  return outcome?.passed && outcome.prizeDraw ? 'prize_draw' : 'done'
}

// Dev panel is visible ONLY when the URL has `?dev=1` — regardless of
// build mode. `npm run dev` no longer auto-shows the panel; testers
// (mobile or desktop) opt in explicitly by appending the query string.
const isDevMode =
  typeof window !== 'undefined' && /[?&]dev=1\b/.test(window.location.search)

// "Embedded" = the page is running inside a native WebView host rather
// than a desktop browser preview. The phone-frame mockup (.phone-frame)
// is sized for desktop and collapses to height: 0 on a phone-shaped
// viewport, so when embedded we apply `body.is-embedded` and let the
// CSS in styles.css flatten the frame to fill the viewport.
const isEmbedded =
  typeof window !== 'undefined' && (
    !!(window as unknown as { gameResults?: unknown }).gameResults ||
    !!window.webkit?.messageHandlers?.gameResults ||
    /[?&]embed=1\b/.test(window.location.search)
  )

// `?reduced=1` forces the reduced-motion path on (overriding the OS setting),
// so the reduced-motion branches are reproducible from a URL — handy for bug
// repro. The dev panel exposes a live toggle for the same override.
const forceReducedFromUrl =
  typeof window !== 'undefined' && /[?&]reduced=1\b/.test(window.location.search)
if (forceReducedFromUrl) setReducedMotionOverride(true)

export default function App() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState<GameResultsInput | null>(() => readInitialInput())
  const [screen, setScreen] = useState<Screen>(() => {
    const initial = readInitialInput()
    return initial ? firstScreen(initial) : 'boot'
  })
  // The resolved game outcome — from setGameOutcome, or synthesized from a
  // legacy setGameResults. null until it arrives (streaming-native path).
  const [outcome, setOutcome] = useState<GameOutcome | null>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered
    const i = readInitialInput()
    return i ? synthOutcome(i) : null
  })
  // The reveal stops waiting for more cards (enables the finale) once true.
  const [streamSettled, setStreamSettled] = useState(false)
  // Lets the user X out the dev panel for this session — reloading restores it.
  const [devPanelOpen, setDevPanelOpen] = useState(true)
  // Dev-only: force the reduced-motion path on/off without touching OS settings.
  const [forceReduced, setForceReduced] = useState(forceReducedFromUrl)
  // Replays the current mock scenario (set by loadMock / devSlowNoOutcome) so a
  // reduced-motion toggle takes effect at once — screens read the pref at mount.
  const replayScenarioRef = useRef<(() => void) | null>(null)
  const hasFiredReady = useRef(false)
  const hasFiredPackShown = useRef(false)
  const hasFiredResultsShown = useRef(false)
  const hasFiredAvailabilityNeeded = useRef(false)
  const hasFiredAssetErrors = useRef(false)
  const hasRequestedDisplayName = useRef(false)
  // Latches once the user dismisses the terminal handoff (fires flow.complete)
  // so a late outcome can't route them back into the flow after they've left.
  const handoffDone = useRef(false)

  // Username availability — pushed independently via
  // window.setUsernameAvailability(...), or bundled in the outcome's
  // usernameClaim. Seeds from whichever outcome source is present at mount.
  const [availability, setAvailability] = useState<UsernameAvailability | undefined>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered.usernameClaim.availability
    const i = readInitialInput()
    return i ? synthOutcome(i)?.usernameClaim.availability : undefined
  })
  const [alternatives, setAlternatives] = useState<string[] | undefined>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered.usernameClaim.alternatives
    const i = readInitialInput()
    return i ? synthOutcome(i)?.usernameClaim.alternatives : undefined
  })

  // Subscribe to late-arriving native input.
  useEffect(() => {
    const off = subscribeInput((incoming) => {
      setInput(incoming)
      // Only route to the flow from the boot screens. A late/repeat push
      // mid-flow updates the data WITHOUT yanking the user back to the start.
      setScreen((prev) => (prev === 'boot' || prev === 'boot_error') ? firstScreen(incoming) : prev)
      // Back-compat: legacy native delivers the outcome inside setGameResults.
      // Only adopt it if setGameOutcome hasn't already resolved one.
      setOutcome((prev) => prev ?? synthOutcome(incoming))
      if (incoming.usernameClaim.availability) setAvailability(incoming.usernameClaim.availability)
      if (incoming.usernameClaim.alternatives) setAlternatives(incoming.usernameClaim.alternatives)
    })
    return off
  }, [])

  // Subscribe to the game outcome (the streaming-native path). It arrives
  // when native's attestation count crosses the passing threshold, or as a
  // definitive { passed: false } at native's timeout.
  useEffect(() => {
    const off = subscribeOutcome((o) => {
      setOutcome(o)
      // A definitive FAIL means nothing more will stream → settle the reveal.
      // A PASS does NOT settle: native keeps streaming the pack (up to 10)
      // after firing the outcome at the 6th, so we wait for the full stream.
      if (!o.passed) setStreamSettled(true)
      if (o.usernameClaim.availability) setAvailability(o.usernameClaim.availability)
      if (o.usernameClaim.alternatives) setAlternatives(o.usernameClaim.alternatives)
    })
    return off
  }, [])

  // Subscribe to async availability pushes — native may push the result
  // of its People Chain query independently of the outcome.
  useEffect(() => {
    const off = subscribeAvailability((p) => {
      // Last-write-wins, EXCEPT don't let a later 'unknown' clobber an
      // already-resolved 'available'/'taken'.
      setAvailability((prev) =>
        p.availability === 'unknown' && (prev === 'available' || prev === 'taken')
          ? prev
          : p.availability
      )
      if (p.alternatives) setAlternatives(p.alternatives)
    })
    return off
  }, [])

  // How many ON-SHELF attestations to expect before the reveal can settle
  // fast (without waiting out the quiet/cap timers). `attestations.total` is
  // the count the user earned and native streams; clamp to the shelf (native
  // may report more than render) and fall back to the full shelf when it's
  // missing. Drives the settle gate below so an under-10 game fast-settles
  // and a >10 game doesn't wait for arrivals the shelf will never show.
  const expectedAttestations = useMemo(() => {
    const t = input?.attestations.total
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return SHELF_SIZE
    return Math.min(SHELF_SIZE, Math.floor(t))
  }, [input?.attestations.total])

  // A definitive FAIL outcome settles the reveal immediately — nothing more
  // streams. (A PASS does NOT settle: native keeps streaming the pack up to
  // SHELF_SIZE after firing the outcome at the 6th, so we wait for the rest.)
  useEffect(() => {
    if (outcome && !outcome.passed) setStreamSettled(true)
  }, [outcome])

  // Settle the reveal once every expected on-shelf attestation has arrived,
  // the stream goes quiet for STALL_QUIET_MS, or the absolute REVEAL_CAP_MS
  // cap elapses. Deps are [screen, expectedAttestations] ONLY — deliberately
  // NOT `outcome`: a PASS arriving mid-reveal must not tear this effect down
  // and re-arm both timers (that restarted the "absolute" cap and the quiet
  // window even though no new attestation had arrived). The quiet timer
  // resets only on a real push. Counting is on-shelf (indices < SHELF_SIZE),
  // so off-shelf pushes can't settle the reveal over an empty shelf.
  useEffect(() => {
    if (screen !== 'nft_reveal') return
    const settledEnough = () => onShelfAttestationCount(SHELF_SIZE) >= expectedAttestations
    if (settledEnough()) { setStreamSettled(true); return }
    const cap = window.setTimeout(() => setStreamSettled(true), REVEAL_CAP_MS)
    let quiet = window.setTimeout(() => setStreamSettled(true), STALL_QUIET_MS)
    const off = subscribeAttestations(() => {
      if (settledEnough()) { setStreamSettled(true); return }
      window.clearTimeout(quiet)
      quiet = window.setTimeout(() => setStreamSettled(true), STALL_QUIET_MS)
    })
    return () => { window.clearTimeout(cap); window.clearTimeout(quiet); off() }
  }, [screen, expectedAttestations])

  // Boot timeout — if input never arrives, transition to the error screen.
  useEffect(() => {
    if (screen !== 'boot') return
    const t = window.setTimeout(() => {
      sendFlowEvent({ type: 'flow.error', phase: 'boot_timeout' })
      setScreen('boot_error')
    }, BOOT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [screen])

  // Nudge native to query username availability if it didn't include the
  // result. Keyed off the resolved outcome (so it fires once we know the
  // user is a new member who's eligible, with a suggested name to query).
  useEffect(() => {
    if (hasFiredAvailabilityNeeded.current) return
    if (!outcome) return
    const uc = outcome.usernameClaim
    if (!outcome.justBecameMember) return
    if (!uc.eligible) return
    if (!uc.suggestedUsername) return
    if (availability) return  // already known
    hasFiredAvailabilityNeeded.current = true
    sendFlowEvent({
      type: 'flow.username_availability_needed',
      name: uc.suggestedUsername
    })
  }, [outcome, availability])

  // If the initial input is missing the user's display name, ask native for
  // it ONCE (fetchDisplayName emits flow.request_display_name). Guarded by a
  // ref so repeated setInput pushes that still lack a name don't re-fire the
  // request on every input identity change. Once a name arrives we splice it
  // in, but only if one hasn't already landed by another path.
  useEffect(() => {
    if (!input) return
    if (input.member.displayName) return
    if (hasRequestedDisplayName.current) return
    hasRequestedDisplayName.current = true
    fetchDisplayName().then((name) => {
      if (!name) return
      setInput((prev) => prev && !prev.member.displayName
        ? { ...prev, member: { ...prev.member, displayName: name } }
        : prev)
    })
  }, [input])

  // Tag <body> when running inside a native WebView so CSS can flatten
  // the desktop-shaped phone-frame mockup into the viewport.
  useEffect(() => {
    if (!isEmbedded) return
    document.body.classList.add('is-embedded')
    return () => { document.body.classList.remove('is-embedded') }
  }, [])

  // flow.ready fires once per page lifetime, after first paint.
  useEffect(() => {
    if (hasFiredReady.current) return
    hasFiredReady.current = true
    sendFlowEvent({ type: 'flow.ready' })
  }, [])

  // flow.pack_shown fires the first time the treasure-chest screen mounts.
  useEffect(() => {
    if (screen !== 'chest') return
    if (hasFiredPackShown.current) return
    hasFiredPackShown.current = true
    sendFlowEvent({ type: 'flow.pack_shown' })
  }, [screen])

  // flow.results_shown fires when the membership verdict screen mounts
  // (now AFTER the reveal, as its own screen).
  useEffect(() => {
    if (screen !== 'results') return
    if (hasFiredResultsShown.current) return
    hasFiredResultsShown.current = true
    sendFlowEvent({ type: 'flow.results_shown' })
  }, [screen])

  // Awaiting-verdict: after the reveal with no resolved outcome, hold on the
  // "tallying results" screen. Route to the verdict the instant it lands; only
  // after a long wait auto-fall-back to the Pocket handoff. (The screen also
  // offers a manual "Check your Pocket" escape → handoff, see its onSkip.)
  useEffect(() => {
    if (screen !== 'awaiting_verdict') return
    if (outcome) { setScreen('results'); return }
    const t = window.setTimeout(() => setScreen('handoff'), AWAIT_VERDICT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [screen, outcome])

  // Route out of the terminal handoff if the outcome resolves before the user
  // dismisses it. The handoff is the long-wait fallback when the reveal
  // finished with no outcome; a setGameOutcome landing a beat later (a
  // 46s-vs-45s race against the 45s reveal cap) would otherwise be silently
  // discarded — the user would exit never seeing the verdict / prize-draw /
  // username ceremony. Once they tap "Got it" (handoffDone latched, flow.
  // complete fired) we don't yank them back.
  useEffect(() => {
    if (screen !== 'handoff') return
    if (!outcome) return
    if (handoffDone.current) return
    setScreen('results')
  }, [screen, outcome])

  // Drive transitions.
  function advance(): void {
    if (!input) return
    if (screen === 'chest') {
      setScreen('nft_reveal')
    } else if (screen === 'nft_reveal') {
      // Verdict if the outcome resolved; otherwise the Pocket handoff.
      setScreen(nextAfterReveal(outcome))
    } else if (screen === 'results') {
      setScreen(nextAfterVerdict(outcome))
    } else if (screen === 'username_cta') {
      setScreen(nextAfterUsername(outcome))
    } else if (screen === 'prize_draw') {
      // Username already happened before the draw (new members), so the draw
      // is terminal here.
      setScreen('done')
    }
    // 'handoff' is terminal — its CTA goes through handleHandoffDone (fires
    // flow.complete). A late outcome can still route it out; see the effect
    // above.
  }

  // Asset-error rollup: fired once if we entered 'done' with composite
  // failures recorded.
  useEffect(() => {
    if (screen !== 'done') return
    if (hasFiredAssetErrors.current) return
    const w = window as unknown as { __ASSET_FAILURES__?: number }
    const failures = w.__ASSET_FAILURES__ ?? 0
    if (failures > 0) {
      hasFiredAssetErrors.current = true
      sendFlowEvent({
        type: 'flow.error',
        phase: 'assets',
        detail: `composite_failures=${failures}`
      })
    }
  }, [screen])

  function handleBootRetry(): void {
    const fresh = readInitialInput()
    if (fresh) {
      setInput(fresh)
      setOutcome(readBufferedOutcome() ?? synthOutcome(fresh))
      setStreamSettled(false)
      setScreen(firstScreen(fresh))
      return
    }
    setScreen('boot')
  }

  function handleBootClose(): void {
    sendFlowEvent({ type: 'flow.complete' })
  }

  // Terminal handoff dismissal. Latches handoffDone BEFORE firing
  // flow.complete so the route-out effect above can't re-enter the flow.
  function handleHandoffDone(): void {
    handoffDone.current = true
    sendFlowEvent({ type: 'flow.complete' })
  }

  // ── Dev-mode mock loading ──────────────────────────────────────────────
  // Reset shared channels + per-session state for a fresh mock run.
  function startMockSession(upfront: GameResultsInput): void {
    resetAttestations()
    resetOutcome()
    setInput(upfront)
    setOutcome(null)
    setStreamSettled(false)
    setAvailability(undefined)
    setAlternatives(undefined)
    hasFiredPackShown.current = false
    hasFiredResultsShown.current = false
    hasFiredAvailabilityNeeded.current = false
    hasFiredAssetErrors.current = false
    setScreen(firstScreen(upfront))
  }

  // Simulate native: stream attestations, then fire setGameOutcome the way
  // native would. passed → after the 6th attestation; failed → a beat after
  // the stream ends (standing in for native's ~10-min timeout signal).
  function simulateNativeStream(streamCount: number, payload: GameOutcome): void {
    const w = window as unknown as {
      pushAttestation?: (p: unknown) => void
      setGameOutcome?: (p: unknown) => void
    }
    const step = STREAM_DURATION_MS / Math.max(1, streamCount || 1)
    for (let i = 0; i < streamCount; i++) {
      const delay = 200 + i * step
      window.setTimeout(() => w.pushAttestation?.({ index: i, hash: mockAttestationHash() }), delay)
      if (payload.passed && i === 5) {
        window.setTimeout(() => w.setGameOutcome?.(payload), delay + 250)
      }
    }
    if (!payload.passed) {
      const lastDelay = 200 + Math.max(0, streamCount - 1) * step
      window.setTimeout(() => w.setGameOutcome?.(payload), lastDelay + 1500)
    }
  }

  // Translate a (legacy-shaped) mock into the new model: an outcome-
  // independent upfront input + a GameOutcome delivered over the simulated
  // stream. This exercises the real streaming-native path end to end.
  function loadMock(buildFn: () => GameResultsInput): void {
    replayScenarioRef.current = () => loadMock(buildFn)
    const mock = buildFn()
    const passed = mock.attestations.passed === true
    const total = mock.attestations.total
    const streamCount = passed
      ? Math.min(10, total)
      : Math.max(0, Math.min(total, mock.attestations.score ?? 0))
    const upfront: GameResultsInput = {
      attestations: { total },
      member: mock.member.displayName
        ? { justBecameMember: false, displayName: mock.member.displayName }
        : { justBecameMember: false },
      prizeDraw: null,
      usernameClaim: { eligible: false }
    }
    const payload: GameOutcome = {
      passed,
      justBecameMember: mock.member.justBecameMember,
      prizeDraw: mock.prizeDraw,
      usernameClaim: mock.usernameClaim
    }
    startMockSession(upfront)
    simulateNativeStream(streamCount, payload)
  }

  // Dev-only: flip the reduced-motion override and replay the current scenario
  // so the reduced-motion branch (read at screen mount) takes effect now.
  function toggleReducedMotion(): void {
    const next = !forceReduced
    setForceReduced(next)
    setReducedMotionOverride(next)
    replayScenarioRef.current?.()
  }

  // Dev helper: a passing-looking stream that NEVER resolves an outcome, so
  // the reveal stalls into the Prizes-chat handoff.
  function devSlowNoOutcome(): void {
    replayScenarioRef.current = devSlowNoOutcome
    startMockSession({
      attestations: { total: 10 },
      member: { justBecameMember: false, displayName: 'BYTEBORO' },
      prizeDraw: null,
      usernameClaim: { eligible: false }
    })
    const w = window as unknown as { pushAttestation?: (p: unknown) => void }
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => w.pushAttestation?.({ index: i, hash: mockAttestationHash() }), 200 + i * 900)
    }
  }

  // Dev helper: simulate native pushing availability asynchronously.
  function devPushAvailability(value: UsernameAvailability, alts?: string[]): void {
    const w = window as unknown as { setUsernameAvailability?: (p: unknown) => void }
    w.setUsernameAvailability?.({ availability: value, alternatives: alts })
  }

  const userName = useMemo(() => input?.member.displayName ?? '', [input])

  return (
    <div className="page">
      <PhoneFrame ref={frameRef}>
        <ErrorBoundary
          fallback={<BootErrorScreen onRetry={() => window.location.reload()} onClose={handleBootClose} />}
        >
        {screen === 'boot' && (
          <div className="boot-screen" aria-live="polite">
            <div className="boot-mark">⬤</div>
            <div className="boot-copy">Waiting for results…</div>
          </div>
        )}
        {screen === 'boot_error' && (
          <BootErrorScreen onRetry={handleBootRetry} onClose={handleBootClose} />
        )}
        {screen === 'chest' && input && (
          <ChestScreen onOpen={advance} />
        )}
        {screen === 'nft_reveal' && input && (
          <NFTRevealScreen
            frameRef={frameRef}
            streamSettled={streamSettled}
            onContinue={advance}
          />
        )}
        {screen === 'results' && outcome && (
          <ResultsScreen
            outcome={outcome}
            {...(userName ? { displayName: userName } : {})}
            collectedCount={onShelfAttestationCount(SHELF_SIZE)}
            onContinue={advance}
          />
        )}
        {screen === 'prize_draw' && outcome?.prizeDraw && (
          <PrizeDrawScreen
            draw={outcome.prizeDraw}
            name={userName}
            justBecameMember={outcome.justBecameMember}
            onContinue={advance}
          />
        )}
        {screen === 'username_cta' && outcome && (
          <UsernameCTAScreen
            {...(availability ? { availability } : {})}
            {...(outcome.usernameClaim.suggestedUsername
              ? { suggestedUsername: outcome.usernameClaim.suggestedUsername }
              : {})}
            {...(outcome.usernameClaim.previousUsername
              ? { previousUsername: outcome.usernameClaim.previousUsername }
              : {})}
            {...(alternatives ? { alternatives } : {})}
            onContinue={advance}
          />
        )}
        {screen === 'awaiting_verdict' && (
          <AwaitingVerdictScreen onSkip={() => setScreen('handoff')} />
        )}
        {screen === 'handoff' && (
          <HandoffScreen onDone={handleHandoffDone} />
        )}
        {screen === 'done' && (
          <DoneScreen won={!!outcome?.prizeDraw?.won} />
        )}
        </ErrorBoundary>
      </PhoneFrame>

      {isDevMode && devPanelOpen && (
        <div className="dev-panel" role="group" aria-label="Dev mock inputs">
          <span className="dev-panel-label">↪ mock input</span>
          {DEV_MOCKS.map((m) => (
            <button
              key={m.label}
              type="button"
              className="dev-panel-btn"
              onClick={() => loadMock(m.build)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className="dev-panel-btn"
            onClick={devSlowNoOutcome}
            title="Stream a few attestations but never resolve an outcome — exercises the stall → Prizes-chat handoff"
          >
            slow → handoff
          </button>
          <span className="dev-panel-label">↪ reduced motion</span>
          <button
            type="button"
            className="dev-panel-btn"
            aria-pressed={forceReduced}
            onClick={toggleReducedMotion}
            title="Force prefers-reduced-motion on/off (overrides the OS setting) and replay the current mock — exercises the reduced-motion branches"
          >
            {forceReduced ? 'reduced: on' : 'reduced: off'}
          </button>
          <span className="dev-panel-label">↪ push availability</span>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('available')}
            title="Simulate native pushing availability='available' via setUsernameAvailability"
          >
            available
          </button>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('taken', [
              'byteboro1', 'byteboro_42', 'byteboroo', 'realbyteboro'
            ])}
            title="Simulate native pushing availability='taken' with alternatives"
          >
            taken
          </button>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('unknown')}
            title="Simulate native pushing availability='unknown'"
          >
            unknown
          </button>
          <button
            type="button"
            className="dev-panel-btn dev-panel-btn--reload"
            onClick={() => window.location.reload()}
            title="Reload to reset all state"
          >
            ↻ reload
          </button>
          <button
            type="button"
            className="dev-panel-close"
            onClick={() => setDevPanelOpen(false)}
            title="Hide dev panel for this session — reload to bring it back"
            aria-label="Close dev panel"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
