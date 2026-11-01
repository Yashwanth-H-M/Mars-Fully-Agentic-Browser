# Security Policy for Mars

## Reporting Security Vulnerabilities

If you discover a security vulnerability in **Mars**, please report it responsibly.

Please open a private security advisory on GitHub or contact the maintainer directly via email. All reports will be reviewed, validated, and resolved promptly.

### Security Principles in Mars
1. **Isolated Nonce-Delimited Data Boundaries:** Page text is enclosed inside randomized nonce markers (`<<<page-content>>>`) to prevent prompt injection attacks from manipulating the agent into executing malicious instructions.
2. **Deterministic Permission Safeguards:** High-impact consequential actions (payments, account access grants, deletions) require explicit user approval.
3. **Encrypted Local Storage:** All credentials and API keys are stored in encrypted browser storage and never transmitted to third parties.
4. **Ref Fail-Closed:** Action references are strictly document-scoped and fail closed if a page mutates or redirects.
