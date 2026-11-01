# AGENTS.md

This file provides comprehensive guidance to AI coding assistants (e.g., Claude Code, GitHub Copilot, Cursor, Antigravity) when working with this repository.

## Project Overview

**Mars** is a fully agentic AI web automation browser extension for Chrome and Edge, rebuilt from the ground up for maximum speed, deterministic reliability, and zero-compromise privacy. It has two parts:

- **The browser control layer**: a deterministic layer that observes a page, acts on it, and reports what happened. It is part of the extension, and its client is the extension's own agent, in-process.
- **The extension** that end users run: the side panel, the one agent that works in it, model providers, and the features around them. It sits on top of the layer.

## Scope

- **Built and maintained:** the browser control layer, a Chrome extension test panel (`testpanel/`), fixture pages, unit tests, and automated checks (`pnpm autorun`).
- **Built and maintained:** the extension. Its release includes:
  - Side panel per tab with full conversation persistence.
  - One agent loop per conversation with dynamic verification debt clearing.
  - Universal model providers via the Vercel AI SDK (Gemini, Claude, OpenAI, Ollama, LM Studio, etc.).
  - Permission modes: `Auto` (autonomous execution) and `Ask` (pause on sensitive writes).
  - Proactive context elision and adaptive cloud turn pacing preventing TPM/RPM rate limit stalls.
  - Full inch-to-inch transparent audit logging with raw model reasoning, system prompts, DOM outlines, and tool receipts exported directly for Notepad.
  - Glowing border and independent visual multi-cursor overlay on active tabs (with toggle in Settings).
  - Dynamic prompt dashboard with isolated multi-persona system prompts (Default Hybrid, Master MCQ Specialist, Master Coding Specialist).
  - Forfeit action defenses preventing accidental test abandonment while allowing final test submission.
  - Voice input with live transcription (Gemini & OpenAI speech models).
  - Three UI languages (English, Simplified Chinese, Traditional Chinese).
- **Not in scope:** an external standalone daemon, browsers other than Chrome and Edge, an MCP bridge (in first release), or multi-agent planner/navigator hierarchies.

## Fixed Design Constraints

These invariants are settled and must be preserved across all pull requests:

### For the Browser Control Layer:
1. **The layer is part of a Chrome extension, not a standalone tool.** No CLI, no daemon, no socket of its own, no launching or attaching to a browser, no remote CDP over WebSocket.
2. **`chrome.debugger` is the only way to reach CDP.** The product is a Chrome extension.
3. **Puppeteer is the frame manager.** It detects frames, including out-of-process iframes, and tracks their sessions and navigation.
4. **Elements are never found through Puppeteer.** No selectors, `ElementHandle` clicks or selector-based `evaluate`. Element commands are raw CDP commands sent directly to the frame session Puppeteer reports.
5. **No model inside the layer.** The layer is deterministic. Anything requiring an LLM belongs to the agent layer above it.
6. **One identity.** An action operates on the node the agent was shown, addressed by the browser's handle for it.
7. **Refs fail closed.** A ref is valid only for the document it was seen in and only if the agent was shown it. Otherwise the result is a typed error, never a guess.
8. **Retries happen before dispatch.** Once an input event has been sent, the layer does not send another on its own.
9. **Three outcomes, reported separately.** Input dispatched; page reacted; expected state reached.
10. **Observation is read-only.** Capturing state does not mutate the page.
11. **Degrade loudly.** Partial captures and truncation are stated explicitly in the result.
12. **Bounded everything.** Every command, wait, and list has an execution budget.
13. **State is disposable.** A service worker restart, debugger detach, or navigation cleanly invalidates layer state.

### For the Agent & Extension Runtime:
1. **Page content is data, never instructions.** Text from pages reaches the model strictly enclosed inside nonce-delimited markers (`<<<page-content>>>`).
2. **One agent loop per conversation**, with dynamic verification debt clearing.
3. **Proactive Context Elision:** Superceded page outlines are automatically replaced with `[tab X rev Y: page content elided]` when tokens exceed 16,000, keeping active requests lean (~10k–14k tokens) and cutting TPM usage by 80%.
4. **Adaptive Cloud Turn Pacing:** Cloud API requests maintain at least 1.2s minimum spacing between turn inferences to prevent hitting provider Requests-Per-Minute (RPM) limits (bypassed for local Ollama models).
5. **No model tiers.** Every model receives the same agent loop and tools (`screenshot` only for vision models).
6. **Strict Permission Gates:**
   - Reading and navigating never ask.
   - A detected write asks in `Ask` mode and runs automatically in `Auto` mode.
   - Payments, credentials, and access grants require user action.
   - Forfeit actions (`End Practice`, `Restart Practice`) are refused before dispatch during practice.

## Repository Structure

- `entrypoints/` - WXT extension entrypoints:
  - `background/` - Service worker runtime and connection router
  - `sidepanel/` - User chat side panel
  - `options/` - Settings page (API keys, models, prompt dashboard, appearance)
  - `welcome/` - First-run onboarding page
  - `permission/` - Microphone permission request page
  - `offscreen/` - Offscreen document for blob URLs and downloads
  - `testpanel/` - Developer testing panel (`open-test-panel` shortcut)
- `src/browser-control/` - The deterministic browser control layer:
  - `protocol/` - Request/result types, zod schemas, error codes, tool catalog
  - `core/` - Controller, sessions, refs, frames, perception (`enrich.ts`, `layout.ts`, `outline.ts`), interaction (`act.ts`, `pointer.ts`), lifecycle
  - `probe/` - In-page isolated code compiled to a string constant
  - `host/` - Puppeteer connection and frame adapter, `chrome.debugger` session wrapper, `chrome.tabs`
  - `index.ts` - Sole public entrypoint for the layer
- `src/agent/` - Agent runtime:
  - `loop.ts` - Main turn loop, batch execution, pacing, recovery
  - `elision.ts` & `compaction.ts` - Context management, outline stubs, token reduction
  - `tools.ts` - Agent tool definitions (`click`, `set`, `fill_form`, `navigate`, `read`, `snapshot`, `done`)
  - `prompt.ts` - Base system prompt and contract
  - `completion.ts` - Verification debt ledger and finish conditions
- `src/llm/` - AI model integration:
  - `providers.ts` - Provider factories (Google, Anthropic, OpenAI, Ollama, OpenAI-compatible)
  - `catalogue.ts` & `profiles.ts` - Model capabilities, context windows, output limits
  - `stream.ts` - Streaming execution, text tool-call extraction, retry backoff
- `src/store/` - Data storage:
  - `conversations.ts` - IndexedDB message and execution ledger
  - `settings.ts` - User settings, API keys, and `DEFAULT_PROMPT_PRESETS`
- `src/side-panel/` - Chat UI components, transcript, composer, audit log exporter
- `src/options/` - Settings UI, prompt preset editor, model configuration

**Import Rules:**
- `src/browser-control/` never imports from outside its folder.
- Other code imports the layer only through `src/browser-control/index.ts`.
- `src/agent/` interacts with Chrome APIs exclusively through interfaces passed by `src/extension/`.
- `src/side-panel/` and `src/options/` talk to the worker through a typed message protocol.
- `src/llm/` knows nothing about browser APIs.

## Toolchain & Commands

The project is built with WXT and pinned dependencies:
- **Node.js:** 24 LTS
- **pnpm:** 10.34.7 (run via `corepack pnpm <command>`)
- **Frameworks:** WXT 0.21.4, React 18.3.1, TypeScript 6.0.3, Vitest 5.0.5, puppeteer-core ^25.16.0, zod 4.6.7

### Essential Commands:
- `pnpm install` - Install dependencies and generate WXT types
- `pnpm dev` - Live development mode in Chrome with auto-reloading
- `pnpm build` - Compile production extension to `dist/`
- `pnpm zip` - Compile and package extension to `dist-zip/mars-<version>.zip`
- `pnpm type-check` - Strict TypeScript validation (`tsc --noEmit`)
- `pnpm lint` - ESLint validation enforcing architecture and import boundaries
- `pnpm test` - Run full unit test suite (Vitest)
- `pnpm prettier` - Format repository code

## Working Rules

- Always use `pnpm` (or `corepack pnpm`).
- Pure functions receive unit tests over recorded CDP fixtures. Browser-dependent features receive fixture pages and automated checks.
- Keep diffs scoped to one issue/feature per pull request.
- Formatting: Prettier with 2 spaces, semicolons, single quotes, trailing commas, `printWidth: 120`. Use `import type` for type-only imports.
- Never log, commit, or expose credentials. Sensitive inputs (passwords, card numbers, OTPs) are masked in perception and audit logs.
- Never manually edit generated build artifacts (`dist/**`, `.wxt/**`).
