# Privacy Policy for Mars

**Mars** is an open-source, fully agentic AI web browser extension for Chrome and Edge created and maintained by **Yashwanth H M**. This Privacy Policy explains how Mars handles your data.

Mars is licensed under the **Apache License 2.0**. All source code is completely open, auditable, and public.

---

## 🔒 100% In-Browser Privacy & Local Execution
- **Runs Entirely in Your Browser:** There are no Mars backend servers, no proxy middleman, and no user accounts required.
- **Your Logins and Cookies Stay Protected:** Mars interacts with pages through Chrome's native debugger API. Your cookies, passwords, sessions, and active logins never leave your browser profile.
- **Zero Third-Party Tracking:** Mars does not collect or transmit your personal data, browsing history, or identities to any third party.

---

## 🤖 AI Provider Communication
To execute tasks, Mars communicates directly from your browser to the AI providers you configure:
- **Cloud Providers (Gemini, Anthropic, OpenAI, OpenRouter, DeepSeek, etc.):** Web page text, outline representations, and user prompts are sent directly from your browser to your selected AI provider's API endpoint using your own API key.
- **Local Models (Ollama, LM Studio, vLLM, llama.cpp):** When using local models, data never leaves your local machine at all.

---

## 🔑 API Key Security
- Your API keys are stored exclusively in Chrome's encrypted local storage (`chrome.storage.local`).
- Keys are never uploaded, shared, or transmitted anywhere other than direct requests to the AI provider endpoint you explicitly configured.

---

## 📋 Transparent Audit Logging
- Mars provides full transparent audit logging with one-click export for offline inspection.
- Audit logs are generated and stored strictly on your local machine and can be saved directly to your Downloads folder.
