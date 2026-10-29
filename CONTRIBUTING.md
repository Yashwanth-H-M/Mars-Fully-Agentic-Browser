# Contributing to Mars

Thank you for your interest in contributing to **Mars**! Every contribution helps make it faster, smarter, and more powerful.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js:** v24 LTS
- **Package Manager:** `pnpm` (run via `corepack pnpm` if not globally installed)

### Commands
```bash
pnpm install           # Install dependencies and prepare WXT types
pnpm dev               # Run extension in live development mode (loads dist/ in Chrome)
pnpm build             # Production build into dist/
pnpm zip               # Pack production extension into dist-zip/mars-<version>.zip
pnpm type-check        # Run TypeScript checks
pnpm lint              # Run ESLint checks
pnpm test              # Run unit tests via Vitest
```

---

## 📜 Development Guidelines
1. **Always use `pnpm`**: Corepack is pinned in `package.json`.
2. **Speed & Invariants First**: The browser control layer is deterministic—no LLM calls inside the browser control layer.
3. **One change per pull request**: Keep diffs focused and scoped.
4. **Apache-2.0 License**: All contributions will be licensed under the Apache 2.0 License.
