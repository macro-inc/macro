//! Dispatch helpers for the documents index migration from a flat-chunk
//! shape (`documents_v1`) to a parent/child join shape (`documents_v2`).
//!
//! There are two dispatch points:
//!
//! * `destination_uses_join_shape(dest)` — used by writers that take an
//!   explicit `index_override`. Returns `true` for the literal v2 name so
//!   the backfill can target v2 in join-shape mode while normal traffic
//!   keeps flowing flat-shape to v1.
//!
//! * `alias_uses_join_shape()` — used by callers that always target the
//!   `documents` alias (search reads, owner-id deletes, metadata
//!   updates). Driven by the `DOCUMENTS_INDEX_USES_JOIN` env var so we can
//!   flip the alias contract atomically with the alias swap without
//!   per-call introspection.

use std::sync::OnceLock;

/// Physical index name of the join-shape documents index.
pub const DOCUMENTS_V2: &str = "documents_v2";

/// Whether writes targeting this destination should use the parent/child
/// join shape. True for the explicit `documents_v2` name and, when
/// configured via env var, for the `documents` alias too.
pub fn destination_uses_join_shape(destination: &str) -> bool {
    if destination == DOCUMENTS_V2 {
        return true;
    }
    if destination == "documents" {
        return alias_uses_join_shape();
    }
    false
}

/// Whether the `documents` alias currently resolves to a join-shape index.
///
/// Controlled by the `DOCUMENTS_INDEX_USES_JOIN` env var, cached once per
/// process. Operators set it `true` at the alias swap; before then it
/// defaults to `false` so the existing flat-shape paths stay active.
pub fn alias_uses_join_shape() -> bool {
    static ALIAS_USES_JOIN: OnceLock<bool> = OnceLock::new();
    *ALIAS_USES_JOIN.get_or_init(|| {
        std::env::var("DOCUMENTS_INDEX_USES_JOIN")
            .map(|v| v == "true")
            .unwrap_or(false)
    })
}
