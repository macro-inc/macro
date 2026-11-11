# Markdown documents

The block and Drive detail share `MarkdownDocumentContent`. Document loaders wait
for `rust-editor-model` before creating a connection. The flag is opt-in via
PostHog or `VITE_ENABLE_RUST_EDITOR_MODEL=true`; no remote rollout is changed by
this code. Reopen an existing document after changing its model flag, so its WAL
owner remains stable for the open session.

Off uses the existing Notebook, LexicalMarkdown plugins, LoroManager and
CollabProvider. On lazy-loads RustMarkdownEditor, initializes the session WASM on
the main thread, and connects EditorView through SessionPort/SessionExecutor.
Native code owns retries, authorization, WAL and cross-tab adoption. App code
supplies current-account authority and the configured socket URL.
Use `EditorSession.createMacro` so persisted Macro nodes and mirror null fields
match the live sync policy; the generic constructor is for portable clients.

Flagged browser documents use the same account/epoch-fenced offline metadata
cache as native documents. Reconnects always request fresh credentials; cached
permission permits private offline work, never replay of a persisted token.
Logout invalidates the cache epoch before asynchronous clearing.
Offline reopen requires a completed local body snapshot; metadata and WAL alone
must not bootstrap an editable empty document. The browser test waits for that
read-only storage checkpoint before disconnecting.

`editor.open` is a loading flow with `wasm.init`, `state.load` and
`view.reconcile` phases. Close drains native terminal storage before releasing
its lease. Cancelled async opens cannot mount into another document/account.
Keep session WASM and its optional view imports outside the flag-off startup
path; never initialize a worker eagerly.
