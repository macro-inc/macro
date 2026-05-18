//! Dispatch helper for the documents index migration from a flat-chunk
//! shape (`documents_v1`) to a parent/child join shape (`documents_v2`).
//!
//! For now, only writes targeted explicitly at `documents_v2` (via the
//! backfill's `index_override`) take the join-shape code path. Reads, the
//! default-destination write path, and the eventual alias-swap dispatch
//! will come in follow-up changes.

/// Physical index name of the join-shape documents index.
pub const DOCUMENTS_V2: &str = "documents_v2";

/// Whether writes targeting this destination should use the parent/child
/// join shape. True only for the explicit `documents_v2` name today;
/// writes via the `documents` alias keep the flat-chunk shape until we
/// also switch the read path.
pub fn destination_uses_join_shape(destination: &str) -> bool {
    destination == DOCUMENTS_V2
}
