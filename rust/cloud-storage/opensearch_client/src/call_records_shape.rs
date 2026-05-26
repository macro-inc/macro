//! Dispatch helpers for the call_records index migration from a flat
//! one-doc-per-segment shape to a parent/child join shape.
//!
//! Mirrors [`crate::documents_shape`] and [`crate::chats_shape`].

use std::sync::OnceLock;

/// Physical name of the join-shape call_records index. Used as the
/// `index_override` value for backfills that should write in the join
/// shape and as the trigger for `destination_uses_join_shape`.
pub const CALL_RECORDS_V2: &str = "call_records_v2";

/// Default alias name reads target. Production code always uses this.
const DEFAULT_CALL_RECORDS_ALIAS: &str = "call_records";

/// Whether writes targeting this destination should use the parent/child
/// join shape.
pub fn destination_uses_join_shape(destination: &str) -> bool {
    if destination == CALL_RECORDS_V2 {
        return true;
    }
    if destination == DEFAULT_CALL_RECORDS_ALIAS {
        return alias_uses_join_shape();
    }
    false
}

/// Whether the `call_records` alias currently resolves to a join-shape
/// index.
///
/// Controlled by the `CALL_RECORDS_INDEX_USES_JOIN` env var, cached once
/// per process. Operators set it `true` at the alias swap; before then
/// it defaults to `false` so the existing flat-shape paths stay active.
pub fn alias_uses_join_shape() -> bool {
    static ALIAS_USES_JOIN: OnceLock<bool> = OnceLock::new();
    *ALIAS_USES_JOIN.get_or_init(|| {
        std::env::var("CALL_RECORDS_INDEX_USES_JOIN")
            .map(|v| v == "true")
            .unwrap_or(false)
    })
}

/// Alias name that search reads target for call records. Returns
/// `call_records` by default; the `CALL_RECORDS_INDEX_NAME` env var
/// overrides this so local tests can point at a side alias pointing
/// only at the join-shape index without disturbing the shared
/// `call_records` alias.
pub fn call_records_search_alias() -> &'static str {
    static NAME: OnceLock<&'static str> = OnceLock::new();
    NAME.get_or_init(|| match std::env::var("CALL_RECORDS_INDEX_NAME") {
        Ok(s) if !s.is_empty() => Box::leak(s.into_boxed_str()) as &'static str,
        _ => DEFAULT_CALL_RECORDS_ALIAS,
    })
}
