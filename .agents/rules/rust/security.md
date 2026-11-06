---
description: "Authorization and permission checks in backend code."
paths:
  - "crates/**/*.rs"
  - "services/**/*.rs"
  - "tooling/**/*.rs"
globs: "crates/**/*.rs,services/**/*.rs,tooling/**/*.rs"
alwaysApply: false
---

# Rust security and permissions

Authorization and permission checks in backend code.

- **CS-36** Permission grants are stateless HTTP endpoints, not channel messages
  — in-memory channel flows don't survive reconnects.
- **CS-37** Mint narrowly-scoped tokens instead of forwarding the user's full
  JWT downstream — least privilege by construction.
- **CS-38** Tool responses must be valid members of the message chain — include
  `tool_call_id` and required chain metadata.
- **CS-39** Pin third-party GitHub Actions to a commit SHA, not a movable tag.
- **CS-72** Store user or third-party secrets (API keys, OAuth refresh tokens)
  only as AWS KMS ciphertext, following `crates/cursor_api_key` (direct KMS) or
  `crates/microsoft_oauth_grant_db_utils` (envelope: encrypted data key, KMS
  key id, encryption version). Bind the encryption context to the owner so a
  copied row won't decrypt. Hold the plaintext in a type that redacts `Debug`
  and zeroizes on drop, use it immediately (e.g. as a request header), and never
  log or cache it. Deleting the row doesn't revoke the secret upstream; say so
  in any disconnect UI.
