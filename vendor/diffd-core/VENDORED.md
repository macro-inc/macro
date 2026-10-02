# diffd-core

Source: https://github.com/404Wolf/diffd/tree/91a5e3e7719d717c2cd1b6238e146023e8afb1df/crates/diffd-core

Revision: `91a5e3e7719d717c2cd1b6238e146023e8afb1df` (MIT; see LICENSE).

Local changes:
- Resolve upstream package/lint settings and inherit shared dependencies from
  Macro's workspace, including its Utoipa 5 schema derives. The sidecar image
  extracts the same dependency table into a minimal build workspace.
- Register SQL and the tree-sitter-sequel grammar in the shared language registry.
- Translate Lua numeric predicates from the SQL grammar to regex and recognize its
  generic field/parameter/keyword capture aliases in the shared highlighter.
- Cover SQL highlighting, Unicode offsets, and Markdown SQL injections.
- Make the upstream frontend export test opt-in; normal tests must not write an
  unrelated `web/` directory into Macro's workspace.

Update by comparing the upstream crate against this revision, preserving these
changes and running `cargo test -p diffd-core -p agent_review_runtime` from the
repository root. The runtime, service, and standalone sidecar all use this copy.
