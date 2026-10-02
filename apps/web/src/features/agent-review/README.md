# Agent review

The production reader opens from **Review changes** or an agent's code citation.
It uses the shared fullscreen Dialog, covering app and Home/Agents navigation.
Back returns to the mounted conversation. The session also retains the review
workspace so reopening preserves its draft, file selection, and scroll position. Capture, threads, revisions, and Internal MCP are connected through the
session host; the reader has no independent authentication or conversation loop.

- `agent-review.tsx`: production composition, typed routing, citation interception.
- `core`: pure reader models, source contracts, escaped syntax, row folding.
- `queries`: transport and cache adapters for immutable files and live metadata.
- `primitives`: navigation, pinned revisions, comments, retry identity.
- `components`: virtualized code/file lists and Markdown discussions.
- `views`: responsive workspace composition.

`/app/debug/agent-review-ui` retains the original interactive sketch and synthetic
100,000-line fixture. `/app/debug/agent-review-integration` mounts the production
reader with a local test host; use it through the [browser lab](../../../scripts/review-browser/README.md).
Neither debug route is a production fallback.

See [design and architecture](../../../../../docs/AGENT_REVIEW_DESIGN.md) for tool
contracts, resource limits, anchoring, queue recovery, and validation boundaries.
Diffd-derived renderer/fixtures retain provenance and the MIT notice in
`DIFFD_LICENSE`; the backend pins the same upstream revision.
