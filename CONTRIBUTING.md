# Contributing to Mars

Thank you for your interest in contributing to **Mars**! Every contribution helps make it faster, smarter, and more reliable.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js:** v24 LTS
- **Package Manager:** `pnpm` 10.x (run via `corepack pnpm` if not globally installed)
- **Browser:** Google Chrome or Microsoft Edge

### Getting Started
```bash
# Clone the repository
git clone https://github.com/Yashwanth-H-M/Mars-Fully-Agentic-Browser.git
cd Mars-Fully-Agentic-Browser

# Install dependencies and prepare types
corepack pnpm install

# Run in live development mode (loads dist/ unpacked in Chrome)
corepack pnpm dev

# Build the production extension
corepack pnpm build

# Package extension zip into dist-zip/
corepack pnpm zip

# Run tests and type checks
corepack pnpm test
corepack pnpm type-check
corepack pnpm lint
```

---

## 📜 Development Guidelines

1. **Always Use `pnpm`:** Use `corepack pnpm <script>` to match pinned toolchain versions.
2. **Speed & Invariants First:** The browser control layer is deterministic—no LLM calls inside the browser control layer.
3. **One Change per PR:** Keep diffs focused, scoped, and well-tested.
4. **Unit Tests:** Pure functions receive Vitest unit tests over recorded CDP fixtures. Browser-dependent features receive fixture pages.
5. **Formatting:** Follow Prettier settings (2 spaces, semicolons, single quotes, trailing commas, printWidth: 120).
6. **Apache-2.0 License:** All contributions are licensed under the Apache 2.0 License.
