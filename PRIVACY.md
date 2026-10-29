# Privacy Policy for Mars

**Mars** is an open-source, fully agentic AI web browser extension for Chrome and Edge created by **Yashwanth H M**. This Privacy Policy explains how it handles your data.

Mars is licensed under the Apache License 2.0. All source code is completely open and public, so you can verify everything this policy states.

---

## 🔒 100% In-Browser Privacy
- **Runs entirely in your browser:** There are no Mars servers, no proxy middleman, and no user accounts required.
- **Your logins and cookies never leave your browser:** Mars accesses pages through Chrome's native debugger API. Your cookies, passwords, and sessions remain strictly inside your browser profile.
- **Zero External Tracking:** No telemetry, no third-party analytics trackers, and no user profiling.

---

## 🤖 AI Provider Communication
To execute tasks, Mars communicates directly from your browser to the AI providers you configure:
- **Cloud Providers (Gemini, Anthropic, OpenAI, OpenRouter, etc.):** Web page content, screenshots, and task prompts are sent directly to the selected provider's API using your own API key.
- **Local Models (Ollama, LM Studio, vLLM):** If you configure a local server, data never leaves your computer at all.

---

## 🔑 Your API Keys
Your API keys are stored exclusively in Chrome's encrypted local storage (`chrome.storage.local`). They are never shared, uploaded, or transmitted to anyone other than the specific API provider you chose.
