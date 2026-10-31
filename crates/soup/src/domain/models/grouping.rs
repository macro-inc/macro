//! Grouping utilities for soup queries.

/// Grouped request constructors and continuation queries.
pub mod query;

#[cfg(test)]
mod test;

use super::{DynamicSort, EnrichedSoupItem, SoupDocumentServerFacts, SoupPropertiesField};
use indexmap::IndexMap;
use item_filters::ast::EntityFilterAst;
pub use models_grouping::GroupByField;
use models_grouping::{date_bucket_label, date_bucket_order};
use models_pagination::{Base64Str, CursorVal, CursorWithValAndFilter, Identify, SortOn};
use models_soup::item::SoupItem;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

/// Display text for group keys the client cannot label from the key alone,
/// resolved for the caller's grouping field and access. A key absent here
/// keeps itself as its label.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct GroupLabels(HashMap<String, String>);

impl GroupLabels {
    /// The display text resolved for `key`, if any.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }
}

impl FromIterator<(String, String)> for GroupLabels {
    fn from_iter<I: IntoIterator<Item = (String, String)>>(iter: I) -> Self {
        Self(iter.into_iter().collect())
    }
}

/// Resolve label and display order for a group key based on the grouping field.
pub(super) fn resolve_group_label_and_order(
    key: &str,
    group_by: &GroupByField,
    labels: &GroupLabels,
) -> (String, Option<i32>) {
    if let Some((_, ranges)) = group_by.date_ranges() {
        let order = ranges
            .ranges
            .iter()
            .position(|range| range.key == key)
            .unwrap_or(ranges.ranges.len());
        return (key.to_owned(), Some(order as i32));
    }
    match group_by {
        GroupByField::Date => (
            date_bucket_label(key).to_string(),
            Some(date_bucket_order(key)),
        ),
        GroupByField::EntityType => (
            entity_type_labels::label(key).to_string(),
            Some(entity_type_labels::display_order(key)),
        ),
        // Project keys are initiative IDs; keep the dedicated unassigned label.
        GroupByField::Project if key.is_empty() => ("No Project".to_string(), Some(i32::MAX)),
        GroupByField::Project => (labels.get(key).unwrap_or(key).to_string(), None),
        GroupByField::Property { .. } if key.is_empty() => ("Not Set".to_string(), Some(i32::MAX)),
        _ => (key.to_string(), None),
    }
}

/// Metadata about a group of items.
#[derive(Debug, Clone, Serialize)]
pub struct GroupMeta {
    /// Group key
    pub key: String,
    /// Human-readable label for the group
    pub label: String,
    /// Display order for sorting groups (lower = first)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_order: Option<i32>,
    /// Total count of items in this group across all pages
    pub total_count: u32,
    /// Ordered ids of items in this group for the current page.
    /// Each id keys into `GroupedResponse::items`.
    pub item_ids: Vec<Uuid>,
    /// Cursor to load more items specifically from this group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Result of building a grouped response.
#[derive(Debug)]
pub struct GroupedResponse {
    /// Items pool keyed by id. Ordering is described by `groups[].item_ids`.
    pub items: HashMap<Uuid, EnrichedSoupItem>,
    /// Group metadata for each group.
    pub groups: Vec<GroupMeta>,
    /// Page-level cursor for loading more items.
    pub page_cursor: Option<String>,
    /// Authoritative document facts from the same SQL rows.
    pub document_server_facts: HashMap<Uuid, SoupDocumentServerFacts>,
}

/// Build a grouped response from grouped soup items, labeling groups from
/// `labels` where the grouping field leaves the key unlabeled.
pub fn build_grouped_response(
    items: impl IntoIterator<Item = ItemGroupingInfo<SoupPropertiesField>>,
    group_by: &GroupByField,
    sort_method: impl Into<DynamicSort>,
    requested_group_key: Option<String>,
    filters: EntityFilterAst,
    labels: &GroupLabels,
) -> GroupedResponse {
    let sort_method = sort_method.into();
    let mut document_server_facts = HashMap::new();
    struct GroupData {
        total_count: u32,
        item_ids: Vec<Uuid>,
        last_item_id: Option<Uuid>,
        last_cursor_val: Option<CursorVal<DynamicSort>>,
        last_index: usize,
        label: Option<String>,
        display_order: Option<i32>,
    }

    let mut group_stats: IndexMap<String, GroupData> = IndexMap::new();
    let items = items.into_iter();
    let mut items_pool: HashMap<Uuid, EnrichedSoupItem> =
        HashMap::with_capacity(items.size_hint().0);
    let mut get_cursor_val = SoupItem::sort_on(sort_method.timestamp_method());

    for grouped_item in items {
        let key = grouped_item.key.clone();
        let item_id = grouped_item.item.id();
        if let Some(facts) = grouped_item.document_server_facts {
            document_server_facts.insert(item_id, facts);
        }
        let timestamp = get_cursor_val(&grouped_item.item).last_val;
        let cursor_val = models_pagination::CursorVal {
            sort_type: sort_method,
            last_val: sort_method.position(grouped_item.sort_key, timestamp),
        };

        let entry = group_stats.entry(key.clone()).or_insert_with(|| {
            let (label, display_order) = resolve_group_label_and_order(&key, group_by, labels);
            GroupData {
                total_count: grouped_item.total_group_count.min(u32::MAX as usize) as u32,
                item_ids: Vec::new(),
                last_item_id: None,
                last_cursor_val: None,
                last_index: 0,
                label: Some(label),
                display_order: grouped_item.display_order.or(display_order),
            }
        });
        entry.item_ids.push(item_id);
        entry.last_item_id = Some(item_id);
        entry.last_cursor_val = Some(cursor_val);
        entry.last_index = grouped_item.index_in_group;

        // First occurrence wins; later duplicates are dropped instead of
        // overwriting an already-populated entry.
        items_pool
            .entry(item_id)
            .or_insert_with(|| EnrichedSoupItem::from(grouped_item.item));
    }

    let mut groups: Vec<GroupMeta> = group_stats
        .into_iter()
        .map(|(key, data)| {
            let has_more = data.last_index < data.total_count as usize;
            let next_cursor = if has_more {
                data.last_item_id
                    .zip(data.last_cursor_val)
                    .map(|(id, val)| {
                        let cursor: CursorWithValAndFilter<Uuid, DynamicSort, EntityFilterAst> =
                            CursorWithValAndFilter {
                                id,
                                limit: data.item_ids.len(),
                                val,
                                filter: filters.clone(),
                            };
                        Base64Str::encode_json(cursor).type_erase()
                    })
            } else {
                None
            };

            GroupMeta {
                key,
                label: data.label.unwrap_or_default(),
                display_order: data.display_order,
                total_count: data.total_count,
                item_ids: data.item_ids,
                next_cursor,
            }
        })
        .collect();

    groups.sort_by(|a, b| {
        a.display_order
            .unwrap_or(i32::MAX)
            .cmp(&b.display_order.unwrap_or(i32::MAX))
    });

    let page_cursor = if requested_group_key.is_some() {
        groups.first().and_then(|g| g.next_cursor.clone())
    } else {
        None
    };

    GroupedResponse {
        items: items_pool,
        groups,
        page_cursor,
        document_server_facts,
    }
}

/// Entity type labels for grouping.
pub mod entity_type_labels {
    /// Get human-readable label for an entity type key.
    pub fn label(key: &str) -> &'static str {
        match key {
            "document" => "Documents",
            "email" => "Emails",
            "calendar_event" => "Calendar",
            "channel" => "Messages",
            "chat" => "Chats",
            "project" => "Projects",
            "call" => "Calls",
            _ => "Other",
        }
    }

    /// Get display order for an entity type key.
    pub fn display_order(key: &str) -> i32 {
        match key {
            "document" => 0,
            "email" => 1,
            "calendar_event" => 2,
            "channel" => 3,
            "chat" => 4,
            "project" => 5,
            "call" => 6,
            _ => 7,
        }
    }
}

/// A Soup item paired with the metadata needed to place it into a group.
#[derive(Debug)]
pub struct ItemGroupingInfo<T = (), Bin = String> {
    /// The key of the bin containing the item.
    pub key: Bin,
    /// The total number of items in the bin across all pages.
    pub total_group_count: usize,
    /// The item's position within its bin.
    pub index_in_group: usize,
    /// Numeric key read with the item.
    pub sort_key: Option<f64>,
    /// Stored option rank, when grouping by selectable values.
    pub display_order: Option<i32>,
    /// Server facts carried through grouped enrichment.
    pub document_server_facts: Option<SoupDocumentServerFacts>,
    /// The Soup item.
    pub item: SoupItem<T>,
}
