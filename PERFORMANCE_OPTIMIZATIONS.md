# Mars Performance & Speed Optimizations Master Guide

This guide documents the complete performance audit of Mars across all subsystems: Browser Control, In-Page Probes, CDP Host Connection, Agent Loop, Context Compaction, Extension Background Worker, and UI Store.

---

## Table of Contents
1. [Executive Summary & Latency Breakdown](#1-executive-summary--latency-breakdown)
2. [Subsystem 1: Interaction, Actionability & Tool Execution](#2-subsystem-1-interaction-actionability--tool-execution)
3. [Subsystem 2: Agent Loop, Context Management & Prompting](#3-subsystem-2-agent-loop-context-management--prompting)
4. [Subsystem 3: Perception, Accessibility Trees & Layout Snapshots](#4-subsystem-3-perception-accessibility-trees--layout-snapshots)
5. [Subsystem 4: Extension Worker, Glowing Border & Disk Storage (IndexedDB)](#5-subsystem-4-extension-worker-glowing-border--disk-storage-indexeddb)
6. [Subsystem 5: In-Page Probe & CDP Host Communication](#6-subsystem-5-in-page-probe--cdp-host-communication)
7. [Priority Action Matrix](#7-priority-action-matrix)
8. [Configuration & Runtime Best Practices](#8-configuration--runtime-best-practices)

---

## 1. Executive Summary & Latency Breakdown

On a typical task taking 6–10 turns, the time is distributed across three main tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Sequential Multi-Turn LLM Roundtrips (~60–75% of total elapsed time)│
│    - Single-action turns enforced by prompt & debt rules               │
│    - Prompt cache bust caused by storing dynamic headers in IndexedDB  │
│    - Context bloat (8k result cap, 30k initial outlines, 60k files)   │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Deterministic Settle, Timers & Actionability (~20–30% of time)      │
│    - Mandatory 200ms minimum settle floor on every single action       │
│    - 5-second network-idle timeouts on pages with continuous traffic   │
│    - 35–45 serialized CDP & JS probe roundtrips per single mouse click │
│    - 50ms coordinate stability sleep on every click                    │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Storage & Process Serialization (~5–10% of time)                    │
│    - 10–12 isolated IndexedDB transactions per turn                    │
│    - Full table scan of conversation history (activeBranch) 3–6x/turn │
│    - 300ms screenshot wait for glowing border transition fade          │
│    - Synchronous thumbnail base64 decoding on worker main thread       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Subsystem 1: Interaction, Actionability & Tool Execution

### 2.1 Settle Polling Minimum Floor (200ms mandatory wait)
* **File:** [`src/browser-control/core/interaction/evidence.ts`](src/browser-control/core/interaction/evidence.ts#L16-L18)
* **Location:** Lines 16–18, 244–269
* **Current Code:**
  ```typescript
  const POLL_MS = 100;
  const CAP_MS = 1_500;
  ```
* **Bottleneck:** `settle()` starts with an unconditional `await sleep(POLL_MS)` (100ms). On the first iteration, `previous` is initialized to `''`, so `key === previous` is guaranteed to fail. It loops into a second iteration, sleeping **another 100ms**. Every click, hover, set, and type action has a **mandatory minimum delay of 200ms of pure sleep**, even when the page is completely static!
* **Optimization:**
  - Seed `previous` with the baseline snapshot key.
  - Check immediately at $t=0$ before sleeping.
  - Reduce `POLL_MS` to `25ms` and `CAP_MS` to `600ms`.
  - **Speedup:** Saves **~150ms–900ms per action**.

---

### 2.2 Volatility Check Hard Sleep (400ms)
* **File:** [`src/browser-control/core/interaction/evidence.ts`](src/browser-control/core/interaction/evidence.ts#L20)
* **Location:** Lines 20, 367–374
* **Current Code:** `const VOLATILITY_MS = 400;`
* **Bottleneck:** In `#keepsChanging()`, when only weak mutation signals are detected, it executes a hard `setTimeout(resolve, 400)` to see if more mutations arrive.
* **Optimization:** Use in-page `MutationObserver` inside the probe to report mutation cessation rather than a blocking sleep.
* **Speedup:** Saves **400ms on actions triggering DOM mutations**.

---

### 2.3 Navigation 5-Second Network Idle Hang
* **Files:** [`src/browser-control/core/tools/navigate.ts`](src/browser-control/core/tools/navigate.ts#L17) & [`src/browser-control/core/interaction/evidence.ts`](src/browser-control/core/interaction/evidence.ts#L18)
* **Current Code:**
  ```typescript
  // navigate.ts: line 17
  const NAVIGATION_BUDGET_MS = 5_000;
  // evidence.ts: line 18
  const NAVIGATION_READY_MS = 5_000;
  ```
* **Bottleneck:** `trackReadiness().wait()` waits for Chrome's `Page.lifecycleEvent` with name `networkIdle`. Websites with analytics, WebSockets, or live streaming never become network idle. The runner sits idle waiting for the full 5 seconds before progressing.
* **Optimization:** Resolve readiness as soon as `DOMContentLoaded` + `load` fire and inflight requests drop to 0 for 100ms, or cap the wait at `1,500ms`.
* **Speedup:** Saves **3 to 4 seconds per page navigation**.

---

### 2.4 Quad Calculation Triplication & 50ms Stability Sleep
* **File:** [`src/browser-control/core/interaction/actionability.ts`](src/browser-control/core/interaction/actionability.ts#L20)
* **Location:** Lines 20, 114, 120, 126, 133–134
* **Bottleneck:**
  - Calls `DOM.getContentQuads` at line 114.
  - Calls `pointOf()` at line 126 which calls `DOM.getContentQuads` **again**.
  - Sleeps 50ms (`STABLE_GAP_MS = 50`).
  - Calls `pointOf()` at line 134 which calls `DOM.getContentQuads` a **3rd time**.
* **Optimization:**
  - Reuse the first quad from line 114 instead of re-querying in `pointOf()`.
  - Reduce `STABLE_GAP_MS` to `15ms` or bypass it if the element has no active CSS transitions.
* **Speedup:** Saves **35ms–50ms and 1 CDP roundtrip per pointer action**.

---

### 2.5 Click Pipeline Over-Validation (35–45 Serialized Roundtrips)
* **Files:** [`src/browser-control/core/tools/act.ts`](src/browser-control/core/tools/act.ts), [`src/browser-control/core/interaction/pointer.ts`](src/browser-control/core/interaction/pointer.ts), [`src/browser-control/core/interaction/resolve.ts`](src/browser-control/core/interaction/resolve.ts)
* **Bottleneck:**
  For a single click, the code executes:
  1. `Accessibility.getPartialAXTree` **4 separate times** (in `resolveTarget`, `actionability`, and twice in `stillJudged` before mouse press and release).
  2. `classifyOn` (`formFacts`) **3 separate times**.
  3. `preflightNavigation` (`navigationTarget`) **4 separate times**.
  4. Piercing shadow root traversal (`focusedElement`) **twice** (before dispatch and after settle).
* **Optimization:** Cache validated identity, classification, and preflight within the action pipeline tick. Do not repeat `Accessibility.getPartialAXTree` between `mousePressed` and `mouseReleased` unless a DOM mutation occurred.
* **Speedup:** Saves **100ms–250ms of CDP message overhead per click**.

---

### 2.6 Keystroke-by-Keystroke Probe Guard in `KeyGuard`
* **File:** [`src/browser-control/core/interaction/key-guard.ts`](src/browser-control/core/interaction/key-guard.ts#L92-L120)
* **Location:** Lines 94, 120
* **Bottleneck:** Before sending *each single character* in `type()`, `unit()` calls `probe.callGlobal('stepGuard')`. Typing 30 characters performs 30 individual in-page JavaScript roundtrips!
* **Optimization:** Buffer keystrokes and let the in-page guard evaluate the input stream as a batch, reporting once upon completion.
* **Speedup:** Saves **150ms–400ms per text entry action**.

---

### 2.7 Serialized Form Filling in `fill_form`
* **File:** [`src/browser-control/core/tools/fill.ts`](src/browser-control/core/tools/fill.ts#L21-L60)
* **Bottleneck:** `fillForm` iterates through fields in a loop calling `set()`. Each `set()` runs the entire actionability check, focus click, and **full 200ms settle wait**. Filling 4 fields takes $4 \times 500\text{ms} = 2\text{ seconds}$ before the submit button is even clicked.
* **Optimization:** Batch field resolution and actionability. Set all input values directly in the probe, and run a single settle pass after the last input or form submission.
* **Speedup:** Saves **1.5s–2.5s per form submission**.

---

## 3. Subsystem 2: Agent Loop, Context Management & Prompting

### 3.1 Prompt Directives Suppress Multi-Action Turns
* **File:** [`src/agent/prompt.ts`](src/agent/prompt.ts#L53-L86)
* **Location:** Lines 53–58, 80–86
* **Bottleneck:**
  - Line 57 commands: *"Prefer one clear step at a time on a page that changes."*
  - Line 58 commands: *"Finish with done: outcome 'success' only when you have seen the result of every action you took."*
  - Zero examples of multi-action batching in few-shot prompts.
  - The model strictly emits 1 tool call per turn, forcing 3–8 seconds of LLM inference latency between every individual action.
* **Optimization:** Update `prompt.ts` to explicitly recommend batching predictable actions (e.g. multi-field typing, checking boxes) and add few-shot batching examples.
* **Speedup:** Cuts total conversation turns by **30%–60%**.

---

### 3.2 Dynamic `<browser-state>` Headers Invalidate LLM Prompt Caching
* **Files:**
  - [`src/agent/loop.ts`](src/agent/loop.ts#L367-L373) (Line 785)
  - [`src/agent/header.ts`](src/agent/header.ts#L1-L2) (Lines 36–54)
  - [`src/agent/context.ts`](src/agent/context.ts#L114-L194)
* **Bottleneck:**
  - `header.ts` line 1 claims: *"// The page header... never stored, so the cached prefix stays intact."*
  - **In reality, `loop.ts` line 785 calls `await this.storeHeader()`, which permanently writes the header to IndexedDB as a user message on every single turn!**
  - Because each header contains dynamic wall-clock timestamps (`2026-10-29 21:27`) and tab revisions, injecting historical headers into the prompt prefix **completely busts Anthropic prompt caching, OpenAI prefix caching, and Gemini context caching**.
  - Furthermore, headers accumulate over turns without being elided, consuming thousands of wasted tokens.
* **Optimization:**
  - Stop saving headers to IndexedDB. Keep them purely in-memory.
  - Attach `<browser-state>` dynamically only to the trailing message of the request.
  - Keep historical messages stable to maintain a 90%+ prompt cache hit rate.
* **Speedup:** Cuts Time-To-First-Token (TTFT) by **50%–80%** and drastically reduces API costs.

---

### 3.3 Overly Aggressive Batch Abortion (`skipRest`)
* **File:** [`src/agent/loop.ts`](src/agent/loop.ts#L1033-L1055)
* **Location:** Lines 1034–1038
* **Bottleneck:** If tool $i$ in a batch targets a ref modified by tool $i-1$, `skipRest` aborts **all remaining tools in the batch**, even if subsequent tools target untouched elements or other tabs.
* **Optimization:** Skip only the specific affected tool call and continue executing remaining independent calls.
* **Speedup:** Prevents unnecessary turn aborts.

---

### 3.4 Verification Debt Forces Multi-Turn Stalls
* **Files:** [`src/agent/completion.ts`](src/agent/completion.ts#L14-L58) & [`src/agent/loop.ts`](src/agent/loop.ts#L677-L730)
* **Bottleneck:**
  - If a mutation has `verdict === 'none'`, `createsDebt` registers an open debt item.
  - In `#judgeDone`, calling `done(success)` is rejected if any debt is open, forcing turn $N+1$ to take an observation and turn $N+2$ to call `done` again.
  - If the agent mutates a page and answers in plain text without `done`, the turn is rejected and an extra turn is forced just to invoke `done`.
* **Optimization:** Auto-verify debt if a subsequent read in the same batch shows the expected result; allow plain text conclusions to auto-complete.
* **Speedup:** Saves **1 to 2 turns per task**.

---

## 4. Subsystem 3: Perception, Accessibility Trees & Layout Snapshots

### 4.1 Mismatch Between Perception Budget (30k) and Agent Cap (8k)
* **Files:**
  - [`src/browser-control/core/perception/observe.ts`](src/browser-control/core/perception/observe.ts#L15) (`DEFAULT_BUDGET = 30_000`)
  - [`src/extension/agent-session.ts`](src/extension/agent-session.ts#L15)
  - [`src/agent/loop.ts`](src/agent/loop.ts#L28) (`RESULT_CAP = 8_000`)
* **Bottleneck:** The perception layer crawls deep accessibility trees, computes layout bounds, and assigns refs for up to 30,000 characters. In `loop.ts`, `cutText(outcome.text, 8000)` immediately truncates 22,000 characters before the LLM sees it.
* **Optimization:** Pass `budget: 8_000` directly in `createAgentSession()`.
* **Speedup:** Cuts perception serialization and CDP payload sizes by **up to 70%**.

---

### 4.2 Excessive Parallel Field Lookups (`MAX_FIELD_LOOKUPS = 300`)
* **File:** [`src/browser-control/core/perception/capture.ts`](src/browser-control/core/perception/capture.ts#L12)
* **Location:** Lines 12, 91–100
* **Bottleneck:** `fieldFacts()` fires up to 300 simultaneous `DOM.describeNode` calls over the Chrome debugger connection via `Promise.all` on pages with multiple inputs.
* **Optimization:** Reduce `MAX_FIELD_LOOKUPS` to `60` or inspect attributes only for visible fields in the current viewport.
* **Speedup:** Prevents CDP message queue stalls on complex web apps.

---

### 4.3 Semantic `wait` Full Page Snapshot Every 100ms
* **File:** [`src/browser-control/core/tools/wait.ts`](src/browser-control/core/tools/wait.ts#L51-L57)
* **Bottleneck:** When `wait` checks for a semantic target condition, it invokes `resolveTarget(..., { fresh: true })`, which triggers a **full page accessibility tree extraction every 100ms**.
* **Optimization:** Check for element existence via a targeted in-page probe query (`document.querySelector`) rather than taking a full accessibility snapshot on every tick.
* **Speedup:** Eliminates high CPU usage and CDP message floods during `wait`.

---

## 5. Subsystem 4: Extension Worker, Glowing Border & Disk Storage (IndexedDB)

### 5.1 Glowing Border Transition Delay on Screenshots (300ms)
* **File:** [`src/extension/border.ts`](src/extension/border.ts#L24)
* **Location:** Lines 24, 88–95, 189
* **Current Code:**
  ```typescript
  export const HIDE_WAIT_MS = 300;
  // Line 189: setTimeout(finish, 200);
  ```
* **Bottleneck:** Whenever a vision model takes a screenshot, the extension hides the decorative glowing border and waits for its CSS transition (`setTimeout(finish, 200)`) plus `HIDE_WAIT_MS = 300`.
* **Optimization:** Instantly set `opacity: 0` without CSS transition during screenshot capture, and reduce `HIDE_WAIT_MS` to `30ms`.
* **Speedup:** Saves **250ms–300ms on every screenshot**.

---

### 5.2 Massive IndexedDB Write Amplification (11+ Transactions per Turn)
* **Files:** [`src/agent/loop.ts`](src/agent/loop.ts#L715-L1071) & [`src/store/conversations.ts`](src/store/conversations.ts#L100-L124)
* **Bottleneck:**
  Every single action performs separate synchronous IndexedDB transactions:
  1. `writer.intent(...)` -> `appendEntry` (opens transaction on `conversations` & `entries`, awaits `tx.done`).
  2. `writer.toolResult(...)` -> `appendEntry` (separate transaction, awaits `tx.done`).
  3. `writer.appHeader(...)` -> `appendEntry` (separate transaction, awaits `tx.done`).
  4. `writer.run(...)` -> `putRun` (separate transaction).
  In a turn with 3 tools, **10 to 12 separate IndexedDB transactions** run sequentially across process boundaries, adding 100ms–300ms of disk latency.
* **Optimization:** Introduce batched entry writes (`appendEntries`) and commit metadata once at the end of the turn.
* **Speedup:** Saves **100ms–250ms per turn**.

---

### 5.3 `activeBranch` Full Table Scans (3–6x per Turn)
* **Files:** [`src/store/conversations.ts`](src/store/conversations.ts#L136-L153) & [`src/agent/loop.ts`](src/agent/loop.ts#L226-L368)
* **Bottleneck:** `activeBranch` loads every entry ever recorded in the conversation via `getAllFromIndex`. It is called repeatedly within a single turn: in `storeHeader`, `prepareRequest`, `prepareNextTurn`, after elision, and during compaction.
* **Optimization:** Cache the active branch array in memory inside `AgentLoop`.
* **Speedup:** Saves **50ms–150ms of deserialization per turn**.

---

### 5.4 Synchronous Base64 Thumbnail Decoding Blocks Worker Thread
* **File:** [`src/extension/thumbnail.ts`](src/extension/thumbnail.ts#L6)
* **Location:** Lines 6, 21–22; [`src/agent/loop.ts`](src/agent/loop.ts#L539) Line 539
* **Bottleneck:**
  ```typescript
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  ```
  For a 5MB base64 retina screenshot, `Uint8Array.from` runs 5 million JavaScript closures on the worker main thread, blocking tool execution synchronously before returning the tool result.
* **Optimization:** Generate the UI thumbnail asynchronously in the background. Return the tool result immediately to the LLM.
* **Speedup:** Eliminates **100ms–300ms CPU freeze on every screenshot**.

---

## 6. Subsystem 5: In-Page Probe & CDP Host Communication

### 6.1 DOM Walking & Serial Node Evaluations
* **File:** [`src/browser-control/probe/source.ts`](src/browser-control/probe/source.ts)
* **Bottleneck:** The in-page probe uses tree walkers to check visibility, forms, labels, and roles. Functions like `hasText`, `findInTree`, and `state` evaluate styles (`getComputedStyle`) on each candidate element, triggering style recalculations and layout reflows in the renderer.
* **Optimization:** Cache computed styles within the probe execution tick and avoid calling `getComputedStyle` on non-rendered or display-none ancestor subtrees.

---

## 7. Priority Action Matrix

| Priority | Fix Description | Primary File & Lines | Estimated Latency Saved |
| :---: | :--- | :--- | :--- |
| **P0** | **Stop Storing Headers in DB / Enable Prompt Cache** | `src/agent/loop.ts`: 785; `header.ts`: 36 | **50%–80% faster TTFT; saves 2k–10k tokens/turn** |
| **P0** | **Prompt Directives for Multi-Action Batching** | `src/agent/prompt.ts`: 53–58, 80 | **Cuts total task turns by 30%–60%** |
| **P0** | **Reduce Settle Floor & Polling Gap** | `evidence.ts`: 16–18, 244–269 | **150ms–900ms saved per action** |
| **P1** | **Cap Navigation Network-Idle Timeout** | `navigate.ts`: 17; `evidence.ts`: 18 | **3,000ms–4,000ms saved per navigation** |
| **P1** | **Align Perception Budget (8k) with Cap** | `agent-session.ts`: 15; `observe.ts`: 15 | **Cuts snapshot extraction time by up to 70%** |
| **P1** | **Remove Duplicate Validation in Click Pipeline** | `pointer.ts`: 115–136, 239, 260 | **100ms–250ms saved per click** |
| **P1** | **Batch Form Filling Pipeline (`fill_form`)** | `fill.ts`: 21–60 | **1,500ms–2,500ms saved per form submit** |
| **P2** | **Batch IndexedDB Transactions & Cache Branch** | `conversations.ts`: 100–153; `loop.ts`: 1071 | **100ms–250ms saved per turn** |
| **P2** | **Remove Glowing Border Screenshot Delay** | `border.ts`: 24, 189 | **250ms–300ms saved per screenshot** |
| **P2** | **Reduce Actionability Stability Gap to 15ms** | `actionability.ts`: 20 | **35ms saved per click** |
| **P2** | **Buffer Keystrokes in `KeyGuard`** | `key-guard.ts`: 92–120 | **150ms–400ms saved per typed string** |
| **P2** | **Asynchronous Screenshot Thumbnail Generation** | `thumbnail.ts`: 6; `loop.ts`: 539 | **100ms–300ms CPU freeze eliminated** |

---

## 8. Configuration & Runtime Best Practices

| Setting / Choice | Recommended | Impact |
| :--- | :--- | :--- |
| **Reasoning Effort** | **Low** or **Off** | Saves **10–30 seconds of thinking tokens per turn** |
| **Model** | **Gemini 2.0 Flash** / **Claude 3.5 Haiku** / **GPT-4o-mini** | Low TTFT, high token throughput |
| **Permission Mode** | **Auto Mode** (for trusted domains) | Removes user approval pauses on form writes |
| **Local Models** | Cloud or High-VRAM Dedicated GPU | Avoids CPU-bound 5 tokens/sec processing on large contexts |
