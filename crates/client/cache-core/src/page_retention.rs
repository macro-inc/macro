//! Bounded, disposable Soup query snapshots. Entity records and mutation intents
//! are not evicted by this policy. Hydration only needs the entities behind a
//! page, not a durable cursor-qualified entry on the viewer record.

use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, Record};
use std::collections::BTreeSet;

/// Maximum combined flat/grouped Soup snapshots retained on one viewer.
pub const MAX_SOUP_PAGES: usize = 64;
/// Encoded budget for page fields and their write-recency metadata.
pub const MAX_SOUP_PAGE_BYTES: usize = 512 * 1024;
/// Viewer type owning the disposable query entry points.
pub const SOUP_PAGE_OWNER: &str = "GraphqlUser";
pub(crate) const PAGE_ORDER_FIELD: &str = "__cache_soup_page_order_v1";
const ORDER_OVERHEAD_BYTES: usize = PAGE_ORDER_FIELD.len() + 32;

fn is_page_field(key: &str) -> bool {
    matches!(key.split('(').next(), Some("soup" | "groupSoup"))
}

/// Remove only the viewer's page wrappers from hydration updates. Normalized
/// descendants (including email messages), email links and identity survive.
pub(crate) fn omit_hydration_pages(updates: &mut RecordUpdates) {
    for record in updates.values_mut() {
        if record.typename() == Some(SOUP_PAGE_OWNER) {
            record
                .fields
                .retain(|key, _| !is_page_field(key) && key != PAGE_ORDER_FIELD);
        }
    }
}

pub(crate) fn updated_pages(base: &Record, update: &Record) -> Vec<String> {
    if base.typename() != Some(SOUP_PAGE_OWNER) && update.typename() != Some(SOUP_PAGE_OWNER) {
        return Vec::new();
    }
    update
        .fields
        .keys()
        .filter(|key| is_page_field(key))
        .cloned()
        .collect()
}

/// Compact a legacy viewer without changing its entity links, identity, or any
/// other record. Without recency metadata, prefer initial pages to continuations.
pub fn compact_soup_pages(record: &mut Record) -> bool {
    retain_soup_pages(record, &[])
}

/// Prefer freshly written pages, then persisted write-recency order. Reading a
/// page deliberately does not write/touch recency (and cannot cause a COMMIT).
pub(crate) fn retain_soup_pages(record: &mut Record, updated: &[String]) -> bool {
    if record.typename() != Some(SOUP_PAGE_OWNER) {
        return false;
    }
    let previous = match record.fields.get(PAGE_ORDER_FIELD) {
        Some(CacheValue::List(keys)) => keys.as_slice(),
        _ => &[],
    };
    let legacy = || record.fields.keys().filter(|key| is_page_field(key));
    let candidates = updated
        .iter()
        .map(String::as_str)
        .chain(previous.iter().filter_map(|value| match value {
            CacheValue::String(key) => Some(key.as_str()),
            _ => None,
        }))
        .chain(
            legacy()
                .filter(|key| key.contains("\"initial\":"))
                .map(String::as_str),
        )
        .chain(legacy().map(String::as_str));
    let mut seen = BTreeSet::new();
    let mut kept = BTreeSet::new();
    let mut order = Vec::new();
    let mut bytes = ORDER_OVERHEAD_BYTES;
    for key in candidates {
        if order.len() == MAX_SOUP_PAGES {
            break;
        }
        if !is_page_field(key) || !seen.insert(key) {
            continue;
        }
        let Some(value) = record.fields.get(key) else {
            continue;
        };
        // Count without allocating a second copy of a potentially huge legacy
        // page. Include the duplicate key in the order list and its enum tag.
        let size = postcard::experimental::serialized_size(&(key, value))
            .expect("cache fields have a serialized size")
            + postcard::experimental::serialized_size(key)
                .expect("cache keys have a serialized size")
            + 1;
        if size > MAX_SOUP_PAGE_BYTES - bytes {
            continue;
        }
        bytes += size;
        kept.insert(key.to_owned());
        order.push(CacheValue::String(key.to_owned()));
    }
    let old_len = record.fields.len();
    record
        .fields
        .retain(|key, _| !is_page_field(key) || kept.contains(key));
    let mut changed = record.fields.len() != old_len;
    if order.is_empty() {
        changed |= record.fields.remove(PAGE_ORDER_FIELD).is_some();
    } else {
        let order = CacheValue::List(order);
        if record.fields.get(PAGE_ORDER_FIELD) != Some(&order) {
            record.fields.insert(PAGE_ORDER_FIELD.to_owned(), order);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod test;
