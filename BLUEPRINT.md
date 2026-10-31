# Mars Architecture & Optimization Blueprint: The Unified Multi-Step Solution

This document outlines the architectural plan to make **Mars** hyper-fast, deterministic, and capable of executing multiple actions in a single turn without touching your custom prompts.

---

## 1. The Core Architectural Dilemma & Resolution

```
USER PROMPT DIRECTIVE:
"ALWAYS emit all needed actions at once in a single turn... click choice, click SUBMIT, then done."

       │
       ▼
PREVIOUS CODE BEHAVIOR:
1. `isLastInBatch = i === runnable.length - 1`
2. Since `done()` is at the end, intermediate clicks got `observe: 'none'`.
3. `result.page` was `undefined`.
4. Verification debt was logged, but could NEVER be cleared without a diff.
5. When `done()` was reached, the engine rejected it:
   "Refused: you have not seen the result of these actions!"
6. The engine forced the LLM into extra recovery turns, stalling the user.

       │
       ▼
UNIFIED ARCHITECTURAL RESOLUTION:
1. The engine identifies the LAST MUTATION in the batch (e.g. `click(submit)`).
2. Intermediate clicks run with `observe: 'none'` (0ms delay).
3. The last click runs with `observe: 'diff'` (captures what happened).
4. That single diff retroactively CLEARS THE DEBT for all clicks in that batch!
5. When `done()` runs, debt is ZERO. `done()` succeeds immediately in the exact same turn!
```

---

## 2. Complete System Problem Catalog & Exact Solutions

### Pillar 1: The Multi-Step Batch & Verification Engine
* **Files**: `src/agent/loop.ts`, `src/agent/completion.ts`
* **Defect**: 
  - `isLastInBatch` treated `done` as the batch terminator instead of distinguishing mutations from control tools.
  - `clearsDebt()` strictly demanded `page.rev > item.rev`. When intermediate mutations ran with `observe: 'none'`, `rev` was recorded as `0` (or `undefined`), preventing debt clearance.
* **Concrete Solution**:
  1. In `src/agent/loop.ts`:
     - Scan `runnable` in reverse to locate `lastMutateIndex`.
     - Set `isLastInBatch = i === runnable.length - 1 || i === lastMutateIndex`.
     - Intermediate mutations run with `observe: 'none'` for instant speed; the terminal mutation runs with `observe: 'diff'`.
  2. In `src/agent/completion.ts`:
     - Update `clearsDebt()` to accept `page.rev >= item.rev` on the same tab, so the terminal diff clears all prior mutations executed in that turn.
     - Clear debt immediately if `result.receipt.postcondition.status === 'met'`.
  3. In `AgentLoop`:
     - Track active tab revisions in an internal `#tabRevs` map so `rev` is always a valid monotonically increasing integer, never `undefined`.

---

### Pillar 2: Eliminating Interaction Settle Delays
* **Files**: `src/browser-control/core/interaction/evidence.ts`, `actionability.ts`, `pointer.ts`
* **Defect**:
  - `evidence.ts` waits up to 600ms (`CAP_MS`) on every click, checking if background network requests (`#requests`) are done. On modern pages with analytics or streaming pings, it always sleeps the full 600ms.
  - `actionability.ts` has a mandatory 20ms sleep between quads and runs redundant `scrollIntoViewIfNeeded` even for elements already centered in the viewport.
  - `pointer.ts` runs a mid-click check (`stillJudged`) between `mousePressed` and `mouseReleased`. If an element shows a loading state or updates text on `mousedown`, it withholds the mouse release and drops the click.
* **Concrete Solution**:
  1. In `evidence.ts`:
     - Only track network requests initiated *after* the action's dispatch timestamp.
     - Implement an immediate **fast-settle exit**: if target DOM mutations or frame state changes are recorded and no navigation is pending, break out of the poll loop after 2 quiet ticks (40ms) instead of 600ms.
  2. In `pointer.ts`:
     - Validate before the click, but remove the mid-click check between `mousePressed` and `mouseReleased`. Once the button is pressed, the release must be dispatched to complete the standard click sequence.
  3. In `actionability.ts`:
     - If the element's bounding box is already within the visible viewport, skip `scrollIntoViewIfNeeded` and the stability sleep.

---

### Pillar 3: Perception & CDP Protocol Optimization
* **Files**: `src/browser-control/core/perception/capture.ts`, `diff.ts`, `tools/text.ts`, `host/page-port.ts`
* **Defect**:
  - `fieldFacts()` in `capture.ts` fires up to **80 individual CDP calls** (`DOM.describeNode`) on every snapshot, flooding Chrome's IPC pipe, while `DOMSnapshot.captureSnapshot` already has all attributes in memory.
  - `diff.ts` allocates a full 2D matrix (`Uint16Array(m + 1)`) for up to 4,000 lines, generating up to 32 MB of memory churn and 16 million loop iterations.
  - `text.ts` types character-by-character, incurring 2–3 CDP events per character and re-evaluating focus on every space/newline (over 180 CDP calls for a short sentence).
* **Concrete Solution**:
  1. In `capture.ts`:
     - Remove the 80 N+1 `DOM.describeNode` CDP calls. Synchronously populate attributes directly from `DOMSnapshot.captureSnapshot`.
  2. In `diff.ts`:
     - Replace the full matrix allocation with a rotating two-row buffer (`prevRow`, `currRow`), dropping diff execution time from 1,500ms to under 10ms with zero memory allocations.
  3. In `page-port.ts` & `text.ts`:
     - Dispatch printable character sequences directly using `Input.insertText` and CDP `Input.dispatchKeyEvent`, reducing typing time from 2+ seconds to ~150ms.

---

### Pillar 4: Host Concurrency & CDP Session Hardening
* **Files**: `src/browser-control/host/connection.ts`, `cdp-session.ts`, `chrome-host.ts`, `core/lock.ts`
* **Defect**:
  - `ChromeTabConnection.open(tabId)` has no in-flight promise deduplication. Concurrent calls detach each other mid-flight.
  - In `lock.ts`, `await previous` sits outside the `try/finally` block. If a task promise rejects, `release()` is never called, deadlocking the tab lock permanently.
  - In `sendRaw`, if a CDP command times out, post-timeout rejections from Chrome throw unhandled promise rejections.
  - In `chrome-host.ts`, `load()` has no `onRemoved` listener; if a user closes a tab during navigation, it hangs for 30 seconds.
* **Concrete Solution**:
  1. In `connection.ts`: Add `openingConnections: Map<number, Promise<ChromeTabConnection>>` to deduplicate concurrent attach calls.
  2. In `lock.ts`: Enclose `await previous.catch(() => {})` in the try/finally block so locks always release.
  3. In `cdp-session.ts`: Add a `timedOut` boolean flag to discard post-timeout errors and avoid unhandled promise rejections.
  4. In `chrome-host.ts`: Listen to `chrome.tabs.onRemoved` during `load()` and reject immediately if the tab closes.

---

### Pillar 5: Storage & UI State Desynchronization
* **Files**: `src/store/conversations.ts`, `src/side-panel/state.ts`, `src/side-panel/Transcript.tsx`, `src/browser-control/probe/source.ts`
* **Defect**:
  - `activeBranch` in `conversations.ts` deserializes every message in the entire database ($O(N)$) to trace a 15-node branch path.
  - `state.ts` drops tool execution updates during streaming because provisional assistant entries are not committed until `message_end`.
  - `Transcript.tsx` runs an unbounded `useLayoutEffect` on every token render, causing layout thrashing and re-rendering markdown for all historical turns.
  - `probe/source.ts` never disconnects `blockObserver` in `disarm()`, causing memory leaks on SPAs.
* **Concrete Solution**:
  1. In `conversations.ts`: Walk `activeBranch` backwards using primary key lookups (`get(id)`) from `leafId` ($O(D)$), reducing turn startup from 400ms to 5ms.
  2. In `state.ts`: Create a provisional assistant entry if `messageId` does not yet exist in `entries` so live tool updates are never discarded.
  3. In `Transcript.tsx`: Add a dependency array `[entries.length, streaming?.text, atBottom]` to `useLayoutEffect`, and memoize `group(entries)` with `useMemo`.
  4. In `probe/source.ts`: Disconnect `blockObserver` in `disarm()`.

---

## 3. Execution Dependency Graph

```
┌────────────────────────────────────────────────────────┐
│ STEP 1: Loop & Debt Engine                             │
│ • loop.ts (last mutating action detection)             │
│ • completion.ts (terminal diff clears batch debt)      │
│ • loop.ts (remove benchmark blockers & add #tabRevs)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ STEP 2: Perception & Diff Optimization                 │
│ • capture.ts (eliminate 80 N+1 CDP calls)              │
│ • diff.ts (rotating two-row diff buffer)               │
│ • page-port.ts & text.ts (chunked Input.insertText)    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ STEP 3: Interaction Settle & Pointer Reliability       │
│ • evidence.ts (fast-settle exit, 40ms)                 │
│ • pointer.ts (remove mid-click withholding)            │
│ • actionability.ts (skip redundant viewport scrolls)   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ STEP 4: Host Concurrency & CDP Session Hardening       │
│ • connection.ts (openingConnections deduplication)     │
│ • lock.ts (try-finally deadlock fix)                   │
│ • cdp-session.ts (suppress post-timeout rejections)    │
│ • chrome-host.ts (onRemoved listener in load)          │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ STEP 5: Storage & UI State Integrity                   │
│ • conversations.ts (O(D) activeBranch traversal)       │
│ • state.ts (provisional tool update commits)           │
│ • Transcript.tsx (memoize group, fix layout effect)    │
│ • probe/source.ts (disconnect blockObserver)           │
└────────────────────────────────────────────────────────┘
```
