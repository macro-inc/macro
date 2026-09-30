//! Hydration invalidation for Quick Access, without loading search catalogs or
//! hashing unrelated record fields. Keep materialization fields aligned with
//! the Quick Access fragments in history.graphql and crm.graphql.

use super::quick_access_fields;
use crate::value::{EntityKey, Record};
use std::collections::BTreeSet;

// Text fields and bucket eligibility come from the projection itself. These
// additional fields affect ordering or the rows materialized from search hits.
const PRESENTATION_FIELDS: &[&str] = &[
    "ownerId",
    "teamId",
    "createdAt",
    "updatedAt",
    "viewedAt",
    "interactedAt",
    "sortTs",
    "lastInteraction",
    "fileType",
    "subType",
    "channelType",
    "participants",
];

/// Retains only the projection/row fields needed for a before/after comparison.
/// Large unrelated fields (email bodies, properties, cached Soup pages) are
/// never cloned just to decide whether a consumer needs refreshing.
pub(crate) fn snapshot_search_fields(key: &EntityKey<'_>, record: &Record) -> Option<Record> {
    let (_, _, text_fields) = quick_access_fields(key, record)?;
    let fields = text_fields
        .iter()
        .chain(PRESENTATION_FIELDS)
        .chain(["__typename", "deletedAt", "hidden"].iter())
        .filter_map(|field| {
            record
                .fields
                .get(*field)
                .map(|value| ((*field).to_owned(), value.clone()))
        })
        .collect();
    Some(Record { fields })
}

/// Adds both old and new buckets when hydration changes a searchable row.
/// Membership transitions (creation, hiding, deletion, subtype changes) must
/// wake the old bucket too. Missing optional fields becoming available count
/// as changes even when they do not affect fuzzy text or recency.
pub(crate) fn collect_search_changes(
    key: &EntityKey<'_>,
    before: Option<&Record>,
    after: Option<&Record>,
    buckets: &mut BTreeSet<String>,
) {
    let previous = before.and_then(|record| quick_access_fields(key, record));
    let next = after.and_then(|record| quick_access_fields(key, record));
    let changed = match (previous, next) {
        (None, None) => false,
        (Some((old_type, old_bucket, _)), Some((new_type, new_bucket, text_fields)))
            if old_type == new_type && old_bucket == new_bucket =>
        {
            text_fields.iter().chain(PRESENTATION_FIELDS).any(|field| {
                before.and_then(|record| record.fields.get(*field))
                    != after.and_then(|record| record.fields.get(*field))
            })
        }
        _ => true,
    };
    if changed {
        for (_, bucket, _) in previous.into_iter().chain(next) {
            buckets.insert(bucket.to_owned());
        }
    }
}

#[cfg(test)]
mod test;
