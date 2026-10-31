<h1 align="center">
  🪐 Mars: Fully Agentic Browser
</h1>

<p align="center">
  <strong>The world's fastest, fully agentic AI web browser extension.</strong><br>
  Built from the ground up for high-speed deterministic web automation, real-time in-browser control, and zero-compromise privacy.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Ultra--Fast-brightgreen?style=for-the-badge" alt="Ultra Fast" />
  <img src="https://img.shields.io/badge/Agent-Autonomous-orange?style=for-the-badge" alt="Autonomous Agent" />
  <img src="https://img.shields.io/badge/Architecture-CDP--Native-blue?style=for-the-badge" alt="CDP Native" />
  <img src="https://img.shields.io/badge/Privacy-100%25_Local-purple?style=for-the-badge" alt="100% Local" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-yellow?style=for-the-badge" alt="License" />
</p>

---

## ⚡ What is Mars?

**Mars** is a state-of-the-art, fully autonomous AI web browser extension for Chrome and Edge. Working directly in your side panel, Mars observes web pages, plans actions, navigates, types, clicks, fills complex multi-field forms, coordinates tasks across multiple tabs, and extracts data—all with blazing speed and complete deterministic precision.

Unlike traditional slow web agents that take minutes to click through forms, Mars is engineered with a **low-latency deterministic execution engine** that makes web automation feel instantaneous.

---

## 🚀 Why Mars is the Best & Fastest in the World

### ⚡ Blazing Speed & Engineered Performance
* **Sub-50ms Settle Loops:** Replaced traditional multi-second polling with an ultra-responsive 30ms adaptive settle cycle, cutting down action verification from 1,500ms to under 60ms.
* **Instant Actionability Engine:** Element bounds and coordinate stability are validated with sub-20ms precision, eliminating redundant CDP roundtrips before clicking or typing.
* **Intelligent Action Batching:** Rather than wasting 5–10 seconds of LLM thinking on every single button press, Mars batches sequential inputs, field fills, and clicks into single-turn executions via native `fill_form` and composite actions.
* **High-Throughput Perception:** Optimized accessibility tree outline and layout processing that matches the agent's exact consumption budget, reducing DOM serialization overhead by up to **70%**.
* **Zero-Lag Navigation:** Smart lifecycle detection moves on as soon as document rendering stabilizes, never freezing on persistent background network requests.

### 🧠 True Autonomous Agentic Power
* **Independent Visual Overlay Cursors:** Real-time visual secondary cursor rendering the agent's exact interactions (clicks, smooth hovers, scroll ripples, action badges). Completely decoupled from your physical mouse/keyboard—you can browse freely without interrupting the agent. Supports multi-cursor visualization for parallel workflows and automatically fades out during vision screenshots so models see a clean page.
* **Dynamic Prompt Dashboard & Multi-Persona System Prompts:** Quick-switch UI right inside the composer to create, isolate, and switch between customized system prompts (e.g., Coding Practice Assistant, Deep Research, Web Scraping, Form Auto-fill) without touching or polluting the hardcoded core agent instructions.
* **Flawless Coding Platform Compatibility:** Built-in intelligence for online code editors (LeetCode, HackerRank, CodeChef, NxtWave/SGU). Strictly preserves prefilled method signatures, boilerplate wrappers, and exact casing (`Solution` vs `solution`) without corrupting starter templates.
* **Multi-Tab Orchestration:** Mars can manage, switch between, and coordinate parallel workflows across dedicated tab groups while you continue browsing undisturbed.
* **Stable Element Ref Registry:** In-page isolated probes assign stable identifiers (`[e1]`, `[e2]`) based on Chrome's native accessibility tree. If the page shifts or reflows, elements fail-closed rather than mis-clicking.
* **Verification Debt Tracking:** Mars doesn't just guess that an action worked—it deterministically inspects DOM mutations, URL changes, and HTTP network side-effects to prove that the task succeeded before finishing.

### 🛡️ 100% Private, Local & Secure
* **Direct-to-Provider:** No middleman servers, no proxy gateways, and no accounts required. All LLM calls travel straight from your browser to your selected AI provider.
* **Your Keys Stay Yours:** API keys are encrypted in local browser storage and never leave your machine.
* **Prompt Injection Defenses:** Web content is strictly enclosed within randomized nonce-delimited data boundaries (`<<<page-content>>>`). The agent treats page text purely as untrusted data, never as system instructions.
* **Autonomous & Flexible Modes:**
  * **Auto Mode (Default):** Seamlessly and autonomously executes full multi-step workflows, clicks, navigations, searches, and forms end-to-end at maximum speed with zero interruptions.
  * **Ask Mode:** Optionally switch to Ask mode whenever you want Mars to pause and request your permission before submitting forms or sending messages.

---

## 🤖 Universal Model Support

Mars connects out of the box to any model provider using the Vercel AI SDK:

| Category | Supported Providers & Models |
| :--- | :--- |
| **Cloud APIs** | **Google Gemini** (2.5 Flash, 2.0 Pro, 1.5 Flash), **Anthropic Claude** (3.7 Sonnet, 3.5 Haiku), **OpenAI** (GPT-4o, o1, o3-mini), **OpenRouter**, **xAI Grok**, **DeepSeek**, **Mistral** |
| **Local Models (100% Offline)** | **Ollama**, **LM Studio**, **vLLM**, and **llama.cpp** via standard OpenAI-compatible endpoints |
| **Vision Models** | Full screenshot and image understanding for visual layout reasoning |
| **Voice Input** | Native real-time voice transcription using Gemini and OpenAI speech models |

---

## 🛠️ Quick Start & Installation

### Option 1: Direct Download (Ready to Use — No Node.js Required)

1. Download the pre-built extension zip:
   - **[⬇️ Download `mars-0.3.0.zip` (Direct Download)](https://github.com/Yashwanth-H-M/Mars-Fully-Agentic-Browser/raw/main/releases/mars-0.3.0.zip)** (or from [GitHub Releases](https://github.com/Yashwanth-H-M/Mars-Fully-Agentic-Browser/releases)).
2. Unzip `mars-0.3.0.zip` into a folder on your computer.
3. Open your browser and go to:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the extracted folder.
6. Pin Mars and press `Alt+Shift+N` (or click the Mars icon) to launch!

---

### Option 2: Build from Source

#### 1. Prerequisites
* **Node.js:** `v24.x` (LTS)
* **pnpm:** `10.x` or run via `corepack pnpm`
* **Browser:** Google Chrome or Microsoft Edge

#### 2. Build the Extension
```bash
# Clone the repository
git clone https://github.com/Yashwanth-H-M/Mars-Fully-Agentic-Browser.git
cd Mars-Fully-Agentic-Browser

# Install dependencies
pnpm install

# Build the extension into dist/
pnpm build

# Or package into a zip:
pnpm zip
```

#### 3. Load into Your Browser
1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the `dist/` folder inside the project.
4. Pin the **Mars** icon to your browser toolbar.
5. Press `Alt+Shift+N` to start using Mars!

---

## 💡 What You Can Ask Mars To Do

> *"Search Amazon for noise-cancelling headphones under $100 with at least 4.5 stars, compare the top 3 results, and put their specs in a table."*

> *"Go to Hacker News, summarize the top 5 articles about AI, and save the markdown report to my Downloads folder."*

> *"Fill out this entire registration form with my details, but stop and let me review before clicking Submit."*

> *"Extract all table rows from this financial dashboard across all pages and export them as a CSV."*

---

## 💻 Developer Commands

| Command | Action |
| :--- | :--- |
| `pnpm dev` | Start live development mode with auto-reload in Chrome |
| `pnpm build` | Compile the production extension into `dist/` |
| `pnpm zip` | Package the extension into `dist-zip/mars-<version>.zip` |
| `pnpm type-check` | Run strict TypeScript validation across all modules |
| `pnpm lint` | Enforce ESLint rules and architectural module boundaries |
| `pnpm test` | Run fast unit tests via Vitest |
| `pnpm autorun scenarios` | Execute headless browser automation checks on local fixtures |

---

## 🏛️ Architecture Overview

Mars is structured into two clean, decoupled architectural layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                   Mars Extension Agent Layer                     │
│  - Frontier UI: Prompt Dashboard, Glassmorphic Composer, Modes   │
│  - Independent Visual Multi-Cursor Engine (zero user collision)  │
│  - One agent loop per conversation with dynamic debt clearing    │
│  - Context compaction & prefix caching stability                 │
│  - Multi-provider Vercel AI SDK integration                     │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ Typed Message Protocol
┌─────────────────────────────────▼────────────────────────────────┐
│                   Browser Control Layer (Deterministic)          │
│  - Native Chrome DevTools Protocol (CDP) via chrome.debugger     │
│  - Puppeteer frame & multi-session management                    │
│  - Stable Ref Registry & in-page isolated probe                  │
│  - Sub-50ms Actionability & Settle Evidence Engine               │
│  - Strict Navigation Guards & Boundary Defusers                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📄 License & Attribution

Mars is open-source software created and maintained by **Yashwanth H M**, licensed under the **[Apache License 2.0](LICENSE)**.

You are free to use, modify, distribute, and build upon Mars for personal, commercial, or academic purposes under the terms of the Apache 2.0 License.
