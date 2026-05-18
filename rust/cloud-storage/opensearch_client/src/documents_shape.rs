//! Dispatch helpers for the documents index migration from a flat-chunk
//! shape (`documents_v1`) to a parent/child join shape (`documents_v2`).
//!
//! Three dispatch points:
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
//!
//! * `documents_search_alias()` — the alias name search reads target.
//!   Defaults to `documents`. The `DOCUMENTS_INDEX_NAME` env var
//!   overrides this so local end-to-end tests can read from a side
//!   alias (e.g. one pointing only at the v2 index) without disturbing
//!   the main `documents` alias on shared environments.

use std::sync::OnceLock;

/// Physical index name of the join-shape documents index.
pub const DOCUMENTS_V2: &str = "documents_v2";

/// Default alias name reads target. Production code always uses this.
const DEFAULT_DOCUMENTS_ALIAS: &str = "documents";

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

/// Alias name that search reads target for documents. Returns `documents`
/// by default; the `DOCUMENTS_INDEX_NAME` env var overrides this so local
/// tests can point at a side alias (e.g. one pointing only at v2) without
/// disturbing the shared `documents` alias.
///
/// Only the read path consults this — writes still resolve through
/// `OpenSearchEntityType::Documents.index_name()` so the alias contract
/// for ingestion stays unchanged.
pub fn documents_search_alias() -> &'static str {
    static NAME: OnceLock<&'static str> = OnceLock::new();
    NAME.get_or_init(|| match std::env::var("DOCUMENTS_INDEX_NAME") {
        Ok(s) if !s.is_empty() => Box::leak(s.into_boxed_str()) as &'static str,
        _ => DEFAULT_DOCUMENTS_ALIAS,
    })
}
