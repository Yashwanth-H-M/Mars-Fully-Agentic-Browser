# Mars Architecture & Optimization Blueprint

This document details the architectural blueprint of **Mars**, explaining how its deterministic browser control layer, agent loop, context management engine, and frontier user interface coordinate to deliver high-speed web automation.

---

## 1. System Architecture Overview

Mars is architected into three decoupled layers connected by typed message protocols:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                            │
│  - Side Panel: React 18 chat interface, transcript, model picker      │
│  - Independent Visual Multi-Cursor Overlay: decoupled pointer ripple   │
│  - Prompt Dashboard: isolated personas (Hybrid, MCQ, Coding)          │
│  - Audit Log Exporter: inch-to-inch raw model reasoning & outlines    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Typed RPC Protocol
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Extension Agent Runtime Layer                       │
│  - One agent loop per active conversation                              │
│  - Verification Debt Ledger & dynamic clearance engine                 │
│  - Proactive Context Elision & Adaptive Cloud Turn Pacing              │
│  - Model Gateway: Vercel AI SDK integration (Gemini, Claude, Ollama)   │
│  - IndexedDB Message Store & Run Records                               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Browser Control Protocol
┌───────────────────────────────────▼────────────────────────────────────┐
│                Deterministic Browser Control Layer                     │
│  - Pure CDP connection via chrome.debugger (no WebSocket/CLI/daemon)   │
│  - Puppeteer frame & multi-session tracking                            │
│  - Stable Ref Registry ([e1], [e2]) with fail-closed semantics         │
│  - Dual Perception: Accessibility Tree (AX) + DOMSnapshot layout      │
│  - Custom Control Promotion (styled radios, checkboxes, monaco editors)│
│  - Sub-50ms Settle Evidence Engine & Postcondition Verifier            │
│  - Forfeit Protection & Assessment Submission Gateway                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars

### Pillar 1: Deterministic Browser Control Layer
- **No Model Inside the Layer:** The browser control layer is 100% deterministic and contains zero LLM inference. All decisions requiring intelligence belong to the agent runtime.
- **Chrome Debugger Only:** Reaches the browser strictly through `chrome.debugger.attach` and `chrome.debugger.sendCommand`. No remote WebSockets, no headless daemons, no external processes.
- **Puppeteer as Frame Manager:** Puppeteer core is utilized solely for detecting frames, out-of-process iframes (OOPIFs), and frame navigations. It does not select or click elements.
- **Stable Ref Registry:** Every visible, actionable node receives a deterministic reference tag (`[w1]`, `[w2]`). Elements are addressed by their native `backendDOMNodeId` and CDP object handles, never by CSS selectors or XPath.
- **Custom Control Promotion:**
  - Detects native `<input type="radio">` and `<input type="checkbox">` elements rendered with `opacity: 0`, `display: none`, or 0-bounds.
  - Automatically promotes their interaction targets onto their rendered `<label>` or parent container.
  - Recognizes styled option containers (`OptionItem`, `question-option`, `choice-item`) and assigns them role `radio` with direct clickable container bounds.
- **Forfeit Defense:** Mid-test abort buttons (`End Practice`, `Restart Practice`, `Quit Practice`, `Leave Practice`) are stripped from actionable perception during active assessments and refused before dispatch if targeted. Completion buttons (`END ASSESSMENT`, `Submit Test`) retain full actionable refs for clean test completion.

---

### Pillar 2: Agent Runtime & Verification Debt Engine
- **One Loop per Conversation:** Each user conversation runs an independent agent loop.
- **Atomic Action Batching:**
  - Multiple tool calls within a single turn (e.g. `[click(option_b), click(submit), click(next)]`) are executed sequentially without waiting for LLM roundtrips between them.
  - Intermediate actions execute with `observe: 'none'` (0ms observation overhead).
  - The terminal mutating action in the batch executes with `observe: 'diff'`, producing a single DOM diff that retroactively clears verification debt for all actions in the batch.
- **Proactive Context Elision:**
  - For long-running sessions (such as 15–25 question exams or multi-page scraping tasks), context can quickly balloon into tens of thousands of tokens.
  - Mars monitors total prompt tokens. As soon as context exceeds 16,000 tokens, older superseded DOM snapshots are replaced with compact stubs (`[tab 1 rev 2: page content elided]`).
  - The active page outline is preserved completely intact.
  - This cuts Tokens-Per-Minute (TPM) usage by **~80%**, preventing HTTP 429 rate limit stalls and keeping per-turn latency under 1.5 seconds.
- **Adaptive Cloud Turn Pacing:**
  - Consecutive model inference calls maintain an automatic 1.2-second minimum interval for cloud providers to prevent bursting past Requests-Per-Minute (RPM) quotas.

---

### Pillar 3: Complete Inch-to-Inch Audit Logging
- **Comprehensive Diagnostic Recording:**
  - Records the exact system prompt, active preset, model name, and provider ID.
  - Logs unredacted model reasoning thoughts (e.g. `<think>` blocks, Gemini thought signatures).
  - Captures the exact DOM outline seen by the model on every turn.
  - Stores full tool inputs, execution statuses, execution latencies, token usages, and DOM mutation receipts.
- **One-Click Notepad Export:**
  - Users can export the entire formatted audit log with a single click from the sidepanel header, generating a clean text document ready for immediate inspection in Notepad.

---

### Pillar 4: Frontend UI & Multi-Cursor Overlay
- **Independent Visual Multi-Cursor:**
  - Renders a glowing secondary cursor directly inside the web page where the agent interacts.
  - Visualizes clicks, smooth hovers, and scroll ripples.
  - Completely independent of the user's hardware mouse pointer—users can scroll, read, and type simultaneously without colliding with the agent.
  - Automatically hides during vision model screenshot capture so the model sees an unblemished page.
- **Dynamic Prompt Dashboard:**
  - Allows instant switching between specialized system prompt presets:
    - **Default Hybrid:** General-purpose coding judge and quiz solver.
    - **Master MCQ Specialist:** Specialized in multi-question assessment loops (select choice first, submit, advance).
    - **Master Coding Specialist:** Specialized in online judge workflows (starter template preservation, sample testing, self-healing).

---

## 3. Data Flow Diagram

```
User Prompt
    │
    ▼
Side Panel UI (Composer)
    │
    ▼ Typed Extension RPC
RunManager / AgentLoop
    │
    ├─► Context Management: Elide old outlines (tokens > 16k)
    ├─► Pacing: Ensure >= 1.2s cloud interval
    │
    ▼
Vercel AI SDK (Gemini / Claude / OpenAI / Ollama)
    │
    ▼ Model Reply (Tool Calls: click, set, etc.)
Loop Batch Executor
    │
    ├─► Multi-Cursor Overlay: Render visual pointer on page
    │
    ▼ CDP Command Dispatcher
chrome.debugger (Native CDP)
    │
    ▼
DOM Mutation & Page Reaction
    │
    ▼ Settle Evidence Engine
Evidence Verification (Sub-50ms Settle & Mutation Receipt)
    │
    ▼ Clear Debt & Record Audit Log
Update Transcript & UI
```
