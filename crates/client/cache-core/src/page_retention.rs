//! Bounded, disposable query snapshots on the viewer record. Soup, database and
//! contact-directory pages share one budget; channel message pages have their
//! own, so channels never push out Soup pages or the other way round. Entity
//! records and mutation intents are not evicted by this policy. Hydration only
//! needs the entities behind a page, not a durable cursor-qualified entry on
//! the viewer record.

use crate::normalize::RecordUpdates;
use crate::value::{CacheValue, Record};
use std::collections::BTreeSet;

/// Maximum combined Soup, database and contact snapshots retained on one viewer.
pub const MAX_SOUP_PAGES: usize = 64;
/// Encoded budget for page fields and their write-recency metadata. Fits a
/// 20,000-row database read, including 500-row pages and filter-bearing cursors.
pub const MAX_SOUP_PAGE_BYTES: usize = 2 * 1024 * 1024;
/// Maximum channel message pages linked from one viewer. Each links to the
/// channel's own record, which holds its latest page; the client deletes those
/// records, and this bounds the viewer's links to them, deleted or not. Above
/// what the web client warms at once (up to 40 unread channels and 20 recent
/// ones), so warming never drops the links it just wrote.
pub const MAX_CHANNEL_PAGES: usize = 1024;
/// Encoded budget for channel page links and their write-recency metadata:
/// room for every link at the cap, so the count is the bound.
pub const MAX_CHANNEL_PAGE_BYTES: usize = 256 * 1024;
/// Viewer type owning the disposable query entry points.
pub const SOUP_PAGE_OWNER: &str = "GraphqlUser";
pub(crate) const PAGE_ORDER_FIELD: &str = "__cache_soup_page_order_v1";
pub(crate) const CHANNEL_PAGE_ORDER_FIELD: &str = "__cache_channel_page_order_v1";

/// Viewer page fields retained together, newest write first.
struct PageFamily {
    order_field: &'static str,
    max_pages: usize,
    max_bytes: usize,
    is_field: fn(&str) -> bool,
    /// Legacy fields kept first when the record has no recency metadata.
    is_initial: fn(&str) -> bool,
}

const SOUP_PAGES: PageFamily = PageFamily {
    order_field: PAGE_ORDER_FIELD,
    max_pages: MAX_SOUP_PAGES,
    max_bytes: MAX_SOUP_PAGE_BYTES,
    is_field: is_page_field,
    is_initial: is_initial_soup_page,
};

const CHANNEL_PAGES: PageFamily = PageFamily {
    order_field: CHANNEL_PAGE_ORDER_FIELD,
    max_pages: MAX_CHANNEL_PAGES,
    max_bytes: MAX_CHANNEL_PAGE_BYTES,
    is_field: is_channel_page_field,
    is_initial: no_initial_page,
};

const PAGE_FAMILIES: [&PageFamily; 2] = [&SOUP_PAGES, &CHANNEL_PAGES];

fn is_page_field(key: &str) -> bool {
    matches!(
        key.split('(').next(),
        Some(
            "soup"
                | "groupSoup"
                | "databaseViewRows"
                | "contacts"
                | "contactsByUserIds"
                | "contactsByEmails"
        )
    )
}

fn is_initial_soup_page(key: &str) -> bool {
    key.contains("\"initial\":")
        || (key.starts_with("databaseViewRows(")
            && (!key.contains("\"cursor\":") || key.contains("\"cursor\":null")))
}

/// A channel's latest page, linked from the viewer per channel.
fn is_channel_page_field(key: &str) -> bool {
    key.split('(').next() == Some("channelMessages")
}

fn no_initial_page(_: &str) -> bool {
    false
}

/// Whether the field holds a family's write-recency order, which an incoming
/// snapshot must never replace.
pub(crate) fn is_order_field(key: &str) -> bool {
    PAGE_FAMILIES.iter().any(|family| family.order_field == key)
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
        .filter(|key| PAGE_FAMILIES.iter().any(|family| (family.is_field)(key)))
        .cloned()
        .collect()
}

/// Compact a legacy viewer without changing its entity links, identity, or any
/// other record. Without recency metadata, prefer initial pages to continuations.
pub fn compact_soup_pages(record: &mut Record) -> bool {
    retain_viewer_pages(record, &[])
}

/// Prefer freshly written pages, then persisted write-recency order, in each
/// family. Reading a page deliberately does not write/touch recency (and cannot
/// cause a COMMIT).
pub(crate) fn retain_viewer_pages(record: &mut Record, updated: &[String]) -> bool {
    if record.typename() != Some(SOUP_PAGE_OWNER) {
        return false;
    }
    PAGE_FAMILIES.iter().fold(false, |changed, family| {
        retain_pages(record, family, updated) || changed
    })
}

fn retain_pages(record: &mut Record, family: &PageFamily, updated: &[String]) -> bool {
    let previous = match record.fields.get(family.order_field) {
        Some(CacheValue::List(keys)) => keys.as_slice(),
        _ => &[],
    };
    let legacy = || record.fields.keys().filter(|key| (family.is_field)(key));
    let candidates = updated
        .iter()
        .map(String::as_str)
        .chain(previous.iter().filter_map(|value| match value {
            CacheValue::String(key) => Some(key.as_str()),
            _ => None,
        }))
        .chain(
            legacy()
                .filter(|key| (family.is_initial)(key))
                .map(String::as_str),
        )
        .chain(legacy().map(String::as_str));
    let mut seen = BTreeSet::new();
    let mut kept = BTreeSet::new();
    let mut order = Vec::new();
    let mut bytes = family.order_field.len() + 32;
    for key in candidates {
        if order.len() == family.max_pages {
            break;
        }
        if !(family.is_field)(key) || !seen.insert(key) {
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
        if size > family.max_bytes - bytes {
            continue;
        }
        bytes += size;
        kept.insert(key.to_owned());
        order.push(CacheValue::String(key.to_owned()));
    }
    let old_len = record.fields.len();
    record
        .fields
        .retain(|key, _| !(family.is_field)(key) || kept.contains(key));
    let mut changed = record.fields.len() != old_len;
    if order.is_empty() {
        changed |= record.fields.remove(family.order_field).is_some();
    } else {
        let order = CacheValue::List(order);
        if record.fields.get(family.order_field) != Some(&order) {
            record.fields.insert(family.order_field.to_owned(), order);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod test;
