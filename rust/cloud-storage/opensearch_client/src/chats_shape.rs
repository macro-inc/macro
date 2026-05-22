//! Dispatch helpers for the chats index migration from a flat
//! one-doc-per-message shape to a parent/child join shape.
//!
//! Three dispatch points, mirroring [`crate::documents_shape`]:
//!
//! * `destination_uses_join_shape(dest)` — used by writers that take an
//!   explicit `index_override`. Returns `true` when the override names
//!   the join-shape physical index so the backfill can target it in
//!   join-shape mode while normal traffic continues writing flat docs
//!   through the alias.
//!
//! * `alias_uses_join_shape()` — used by callers that always target the
//!   `chats` alias (search reads, user-id deletes, title updates).
//!   Driven by the `CHATS_INDEX_USES_JOIN` env var so we can flip the
//!   alias contract atomically with the alias swap without per-call
//!   introspection.
//!
//! * `chats_search_alias()` — the alias name search reads target.
//!   Defaults to `chats`. The `CHATS_INDEX_NAME` env var overrides
//!   this so local end-to-end tests can read from a side alias pointing
//!   only at the join-shape index, without disturbing the shared
//!   `chats` alias on dev/prod.

use std::sync::OnceLock;

/// Physical name of the join-shape chats index. Used as the
/// `index_override` value for backfills that should write in the join
/// shape and as the trigger for `destination_uses_join_shape`.
pub const CHATS_V2: &str = "chats_v2";

/// Default alias name reads target. Production code always uses this.
const DEFAULT_CHATS_ALIAS: &str = "chats";

/// Whether writes targeting this destination should use the parent/child
/// join shape.
pub fn destination_uses_join_shape(destination: &str) -> bool {
    if destination == CHATS_V2 {
        return true;
    }
    if destination == DEFAULT_CHATS_ALIAS {
        return alias_uses_join_shape();
    }
    false
}

/// Whether the `chats` alias currently resolves to a join-shape index.
///
/// Controlled by the `CHATS_INDEX_USES_JOIN` env var, cached once per
/// process. Operators set it `true` at the alias swap; before then it
/// defaults to `false` so the existing flat-shape paths stay active.
pub fn alias_uses_join_shape() -> bool {
    static ALIAS_USES_JOIN: OnceLock<bool> = OnceLock::new();
    *ALIAS_USES_JOIN.get_or_init(|| {
        std::env::var("CHATS_INDEX_USES_JOIN")
            .map(|v| v == "true")
            .unwrap_or(false)
    })
}

/// Alias name that search reads target for chats. Returns `chats` by
/// default; the `CHATS_INDEX_NAME` env var overrides this so local
/// tests can point at a side alias pointing only at the join-shape
/// index without disturbing the shared `chats` alias.
pub fn chats_search_alias() -> &'static str {
    static NAME: OnceLock<&'static str> = OnceLock::new();
    NAME.get_or_init(|| match std::env::var("CHATS_INDEX_NAME") {
        Ok(s) if !s.is_empty() => Box::leak(s.into_boxed_str()) as &'static str,
        _ => DEFAULT_CHATS_ALIAS,
    })
}
