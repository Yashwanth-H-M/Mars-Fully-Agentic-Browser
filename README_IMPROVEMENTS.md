# Mars Browser Engine: Complete Codebase Audit & Improvement Plan

> **Goal**: Make Mars fast, deterministic, and reliable, executing all user actions in a single turn without lag, stutter, or false errors, **strictly preserving your custom prompts and instructions**.

---

## 1. Executive Summary: Why Mars Was Slow and Hesitant

The issue was not your prompts. Your prompt clearly commands the model to:
> *"ALWAYS emit all needed actions at once in a single turn to eliminate delays... click choice, click SUBMIT, click NEXT... do not waste time."*

However, the internal code was actively fighting these instructions across four layers:

1. **The Batch Observation Flaw (`loop.ts` & `completion.ts`)**:
   - In any batch (e.g. `[click(option), click(submit), done()]`), the code only checked if an action was the absolute last item in the list (`i === runnable.length - 1`).
   - Because `done()` is a control tool at the end of the batch, all mutating clicks were executed with `observe: 'none'`.
   - With `observe: 'none'`, no page diff was captured.
   - Mars' internal "Verification Debt" system logged these clicks as unverified, and because no diff existed, the debt was never cleared.
   - When the batch reached `done()`, Mars **refused `done()`** with an error: *"Refused: you have not seen the result of these actions. Take a snapshot!"*
   - This forced the agent into extra turns and loops, directly contradicting your prompt.

2. **The 600ms Settle Freeze on Every Action (`evidence.ts`)**:
   - For every single click or keystroke, Mars waited through a 600ms settle polling loop. Even when the DOM updated in 20ms, any persistent background network request (analytics, long-polls, telemetry) forced Mars to idle for the full 600ms.
   - A sequence of 3 actions incurred **~1.8 to 2.5 seconds of artificial sleep**.

3. **N+1 CDP Call Saturation in Perception (`capture.ts`)**:
   - On every observation, `fieldFacts()` fired up to **80 individual CDP calls** (`DOM.describeNode`), even though `captureLayout()` had already fetched the entire DOM tree and all attributes via `DOMSnapshot.captureSnapshot`.
   - This flooded Chrome's IPC channel and added 500ms–1500ms of lag per turn.

4. **Quadratic LCS Diff Algorithm Freezing the Worker (`diff.ts`)**:
   - Comparing outlines allocated an unoptimized full 2D matrix of `Uint16Array(m + 1)`, consuming up to 32 MB of memory and running 16 million loop iterations synchronously on the main thread.

5. **Mid-Click Target Invalidation (`pointer.ts`)**:
   - Between `mousePressed` and `mouseReleased`, Mars ran validation checks. If an element updated its text or attributes on `mousedown` (such as showing a spinner or updating button text), Mars threw `TARGET_CHANGED` and cancelled the mouse release, causing clicks to misfire.

6. **Storage Bottleneck in `activeBranch` (`conversations.ts`)**:
   - To find the current branch, Mars deserialized **every single historical message and DOM payload in IndexedDB** ($O(N)$), instead of walking parent IDs backwards ($O(D)$).

---

## 2. Master Action Plan: The Step-by-Step Fixes

### Phase 1: Enable True Multi-Action Batching (Code Matches Prompt)
* **`src/agent/loop.ts`**:
  - Identify the **last webpage mutating action** in the batch. Ensure that action executes with `observe: 'diff'`, while all earlier actions run with `observe: 'none'` for instant speed.
  - Track tab revisions in `#tabRevs` so `rev` is never `undefined` or defaulting to `0`.
  - Strip hardcoded exam/quiz regexes that block legitimate buttons like "Leave" or "Exit".
* **`src/agent/completion.ts`**:
  - Allow the batch's terminal observation to clear verification debt for all preceding intermediate mutations on that tab.
  - Clear verification debt immediately when `receipt.postcondition.status === 'met'`.
  - With these two changes, batches like `[click(option), click(submit), done()]` complete cleanly in **one single turn**.

### Phase 2: Eliminate Perception & Interaction Latency
* **`src/browser-control/core/perception/capture.ts`**:
  - Eliminate the 80 redundant `DOM.describeNode` N+1 CDP calls; populate field facts directly from `DOMSnapshot`.
* **`src/browser-control/core/perception/diff.ts`**:
  - Replace the 2D matrix allocation with an optimized linear-space Myers / rotating two-row buffer.
* **`src/browser-control/core/interaction/evidence.ts`**:
  - Fast-exit the settle loop as soon as the DOM mutation or click event has completed, ignoring unrelated background network pings.
* **`src/browser-control/core/interaction/pointer.ts`**:
  - Remove the mid-click check between `mousePressed` and `mouseReleased`. Once a press is dispatched, ensure the release completes.
* **`src/browser-control/core/tools/text.ts` & `page-port.ts`**:
  - Chunk consecutive printable characters and dispatch them via `Input.insertText` and CDP `Input.dispatchKeyEvent`, reducing typing time from 2+ seconds to ~150ms.

### Phase 3: Host & CDP Concurrency Hardening
* **`src/browser-control/host/connection.ts`**:
  - Add an in-flight attachment promise registry (`openingConnections`) to prevent concurrent calls to `ChromeTabConnection.open(tabId)` from detaching each other.
* **`src/browser-control/host/cdp-session.ts`**:
  - Suppress post-timeout rejections in `sendRaw` to eliminate unhandled rejection warnings in the service worker.
* **`src/browser-control/core/lock.ts`**:
  - Enclose `await previous` in a try/finally block so rejected promises never deadlock the tab lock.
* **`src/browser-control/host/chrome-host.ts`**:
  - Add a `chrome.tabs.onRemoved` listener in `chromeTabHost.load()` to prevent 30-second hangs if a tab is closed during navigation.

### Phase 4: UI, Storage, & Lifecycle Stability
* **`src/store/conversations.ts`**:
  - Optimize `activeBranch` to traverse backwards via parent IDs ($O(D)$) instead of deserializing the entire database ($O(N)$).
  - Add atomic transactional updates for `RunRecord` to eliminate read-modify-write races.
* **`src/side-panel/state.ts`**:
  - Fix provisional assistant entry handling in `updateRow` so tool updates during streaming are never dropped.
* **`src/side-panel/Transcript.tsx`**:
  - Add dependency arrays to `useLayoutEffect` and memoize `group(entries)` to stop layout thrashing on every token.
* **`src/browser-control/probe/source.ts`**:
  - Disconnect `blockObserver` in `disarm()` to eliminate DOM mutation leaks.
  - Update `accepts` in key-guard to support contenteditable containers and shadow DOM elements.
* **`src/extension/notify.ts`**:
  - Encode `tabId` directly into notification IDs so clicks open and focus the correct tab even after the MV3 service worker has suspended.
* **`src/extension/downloads.ts`**:
  - Add a mutex around `ensureOffscreen()` to prevent duplicate offscreen document creation errors.

---

## 3. Summary of Files to be Updated

| File | Component | Primary Fix |
|---|---|---|
| `src/agent/loop.ts` | Agent Loop | Multi-action last-mutation detection, revision tracking |
| `src/agent/completion.ts` | Debt Engine | Terminal observation clears all batch debts |
| `src/browser-control/core/perception/capture.ts` | Perception | Eliminate 80 N+1 CDP calls |
| `src/browser-control/core/perception/diff.ts` | Perception | Optimized linear-space diff buffer |
| `src/browser-control/core/interaction/evidence.ts` | Interaction | Fast settle without waiting 600ms |
| `src/browser-control/core/interaction/pointer.ts` | Interaction | Remove mid-click invalidation, guarantee click release |
| `src/browser-control/core/tools/text.ts` | Interaction | Fast chunked typing via `Input.insertText` |
| `src/browser-control/core/lock.ts` | Core Lock | Prevent permanent deadlock on rejected task promises |
| `src/browser-control/host/connection.ts` | Host | Attachment deduplication to prevent detach race crashes |
| `src/browser-control/host/cdp-session.ts` | Host | Suppress post-timeout rejections in `sendRaw` |
| `src/browser-control/host/chrome-host.ts` | Host | Add `onRemoved` listener to `load()` |
| `src/store/conversations.ts` | Storage | $O(D)$ linked-list branch traversal in `activeBranch` |
| `src/side-panel/state.ts` | UI State | Prevent dropped tool execution updates during streaming |
| `src/side-panel/Transcript.tsx` | UI Render | Fix layout thrashing and memoize transcript items |
| `src/browser-control/probe/source.ts` | In-Page Probe | Disconnect `blockObserver`, fix contenteditable typing |
| `src/extension/notify.ts` | Lifecycle | Stateless notification IDs for MV3 worker wakeup |
| `src/extension/downloads.ts` | Downloads | Singleton mutex on `ensureOffscreen()` |
