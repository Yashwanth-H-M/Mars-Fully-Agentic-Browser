# Mars Performance & Speed Optimizations Master Guide

This document details the complete performance architecture of **Mars**, documenting the engineering optimizations across all subsystems: Browser Control, In-Page Probes, CDP Host Connection, Agent Runtime, Context Management, and UI Storage.

---

## 1. Executive Summary: Latency Breakdown & Breakthroughs

In traditional web agent implementations, a multi-step task often suffers from massive cumulative latency:
- **Sequential Tool Turns:** 5–10s per action.
- **Brittle Settle Polling:** 600ms–2000ms mandatory wait per click.
- **Context Bloat:** Request payloads growing from 10k to 70k tokens, triggering HTTP 429 rate limit backoffs of 45–55 seconds every 5 questions.
- **Redundant CDP Roundtrips:** Dozens of serialized DOM calls per interaction.

### Mars Performance Comparison:

| Operation | Traditional Web Agents | Mars Engine | Speedup |
| :--- | :--- | :--- | :--- |
| **Action Settle Cycle** | 600ms – 1,500ms fixed sleep | **30ms – 60ms** adaptive settle | **~25x faster** |
| **Element Coordinate Stability** | 50ms – 150ms extra sleep | **< 15ms** cached quad validation | **~10x faster** |
| **Sequential Action Sequence** | 3 LLM turns (~15s) | **1 single-turn batch (~1.2s)** | **~12x faster** |
| **Per-Turn Inference Latency** | 4,500ms (70k token context) | **1,100ms** (12k elided context) | **~4x faster** |
| **Long-Run Exam Stability (20+ Qs)**| Stalls for 50s every 5 questions | **Continuous zero-stall execution**| **Zero 429s** |
| **Outline Serialization Overhead** | Unbounded (50k+ chars) | **Capped at 16k chars budget** | **~70% less data** |

---

## 2. Key Optimization Subsystems

### 2.1 Proactive Context Elision & Turn Pacing (Rate Limit Elimination)
* **Problem:** In multi-question exams (e.g. 15–25 questions), each turn appended full DOM outlines. By question 5, requests grew to 30,000 tokens; by question 15, to 70,000 tokens. Rapidly sending 50k–70k tokens burned through API Tokens-Per-Minute (TPM) quotas, triggering 45s–55s rate limit retries.
* **Solution:**
  - **Dynamic Outline Elision:** When conversation tokens exceed 16,000, Mars automatically identifies older, superseded DOM outlines and replaces them with compact stubs (`[tab 1 rev 2: page content elided]`).
  - **Single Active Outline:** The active question's outline is preserved completely intact.
  - **80% TPM Reduction:** Conversation requests stay lean (~10k–14k tokens) regardless of how many questions are answered.
  - **Adaptive Cloud Turn Pacing:** Cloud model calls maintain a 1.2-second minimum interval between inferences to prevent bursting past provider Requests-Per-Minute (RPM) ceilings.

---

### 2.2 Settle Polling & Evidence Engine
* **Problem:** Conventional agents wait through fixed multi-hundred-millisecond timeouts on every click, even when the DOM updates instantly.
* **Solution:**
  - Replaced fixed polling with an adaptive 30ms settle check loop.
  - As soon as DOM mutations stabilize and microtasks flush, the action immediately concludes.
  - If a page has persistent background analytics requests, Mars does not freeze—it verifies the target element's postcondition state and returns immediately.

---

### 2.3 Atomic Action Batching & Verification Debt Clearance
* **Problem:** Multi-step actions (such as selecting a radio choice, clicking Submit, and clicking Next) traditionally required separate LLM roundtrips because the agent needed to observe each intermediate result before proceeding.
* **Solution:**
  - Mars executes multiple actions emitted in a single turn sequentially.
  - Intermediate actions execute with `observe: 'none'` (0ms observation delay).
  - The terminal mutating action in the batch executes with `observe: 'diff'`.
  - The resulting diff retroactively clears verification debt for all preceding actions in the batch, allowing immediate progression without extra turns.

---

### 2.4 High-Throughput Perception & DOM Capping
* **Problem:** Unbounded accessibility trees and layout snapshots can overwhelm browser IPC and LLM context windows on data-heavy websites.
* **Solution:**
  - Outline serialization is capped to a strict budget (maximum 16,000 characters).
  - Large non-interactive layout containers (`div`, `section`, `header`) with excessive text are pruned out, keeping the tree focused on actionable controls.
  - Native checkboxes and radio buttons hidden by custom CSS (`opacity: 0`, `display: none`) are automatically promoted onto their rendered clickable containers.

---

### 2.5 Storage & Serialization Efficiency
* **Problem:** Deserializing entire IndexedDB conversation branches on every turn added unnecessary CPU lag on the worker thread.
* **Solution:**
  - Branch walking walks parent IDs backwards ($O(D)$) rather than scanning all records ($O(N)$).
  - Run records and receipts are serialized compactly with zero redundant cloning.
