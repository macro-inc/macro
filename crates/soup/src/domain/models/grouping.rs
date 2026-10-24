//! Grouping utilities for soup queries.

/// Grouped request constructors and frozen continuation policy.
pub mod query;

#[cfg(test)]
mod test;

use super::{EnrichedSoupItem, SoupPropertiesField};
use indexmap::IndexMap;
use item_filters::ast::EntityFilterAst;
use models_grouping::{GroupByField, GroupingConfig, date_bucket_label, date_bucket_order};
use models_pagination::{
    Base64Str, CursorVal, CursorWithValAndFilter, DueDateSort, Identify, SimpleSortMethod, SortOn,
};
use models_soup::item::SoupItem;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

/// Resolve label and display order for a group key based on the grouping field.
fn resolve_group_label_and_order(key: &str, group_by: &GroupByField) -> (String, Option<i32>) {
    match group_by {
        GroupByField::Date => (
            date_bucket_label(key).to_string(),
            Some(date_bucket_order(key)),
        ),
        GroupByField::Deadline { .. } => match key {
            "overdue" => ("Overdue".to_string(), Some(0)),
            "today" => ("Today".to_string(), Some(1)),
            "tomorrow" => ("Tomorrow".to_string(), Some(2)),
            "next_7_days" => ("Next 7 days".to_string(), Some(3)),
            "later" => ("Later".to_string(), Some(4)),
            _ => ("No due date".to_string(), Some(5)),
        },
        GroupByField::EntityType => (
            entity_type_labels::label(key).to_string(),
            Some(entity_type_labels::display_order(key)),
        ),
        GroupByField::Project if key.is_empty() => ("No Project".to_string(), Some(i32::MAX)),
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
}

/// Build a grouped response from grouped soup items.
pub fn build_grouped_response(
    items: impl IntoIterator<Item = ItemGroupingInfo<SoupPropertiesField>>,
    group_by: &GroupByField,
    sort_method: SimpleSortMethod,
    requested_group_key: Option<String>,
    filters: EntityFilterAst,
) -> GroupedResponse {
    let grouping = GroupingConfig {
        field: group_by.clone(),
        group_key: requested_group_key,
        per_group_limit: None,
    };
    build_timestamp_grouped_response(items, &grouping, sort_method, filters)
}

/// Build timestamp groups while retaining frozen deadline context when required.
pub fn build_timestamp_grouped_response(
    items: impl IntoIterator<Item = ItemGroupingInfo<SoupPropertiesField>>,
    grouping: &GroupingConfig,
    sort_method: SimpleSortMethod,
    filters: EntityFilterAst,
) -> GroupedResponse {
    let group_by = &grouping.field;
    let requested_group_key = &grouping.group_key;
    let deadline = matches!(group_by, GroupByField::Deadline { .. });
    struct GroupData {
        total_count: u32,
        item_ids: Vec<Uuid>,
        last_item_id: Option<Uuid>,
        last_cursor_val: Option<CursorVal<SimpleSortMethod>>,
        last_index: usize,
        label: Option<String>,
        display_order: Option<i32>,
    }

    let mut group_stats: IndexMap<String, GroupData> = IndexMap::new();
    let items = items.into_iter();
    let mut items_pool: HashMap<Uuid, EnrichedSoupItem> =
        HashMap::with_capacity(items.size_hint().0);
    let mut get_cursor_val = SoupItem::sort_on(sort_method);

    for grouped_item in items {
        let key = grouped_item.key.clone();
        let item_id = grouped_item.item.id();
        let cursor_val = get_cursor_val(&grouped_item.item);

        let entry = group_stats.entry(key.clone()).or_insert_with(|| {
            let (label, display_order) = resolve_group_label_and_order(&key, group_by);
            GroupData {
                total_count: grouped_item.total_group_count.min(u32::MAX as usize) as u32,
                item_ids: Vec::new(),
                last_item_id: None,
                last_cursor_val: None,
                last_index: 0,
                label: Some(label),
                display_order,
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
            let has_more = if deadline {
                data.last_index < data.total_count as usize
            } else {
                (data.item_ids.len() as u32) < data.total_count
            };
            let next_cursor = if has_more {
                data.last_item_id
                    .zip(data.last_cursor_val)
                    .map(|(id, val)| {
                        let cursor: CursorWithValAndFilter<
                            Uuid,
                            SimpleSortMethod,
                            EntityFilterAst,
                        > = CursorWithValAndFilter {
                            id,
                            limit: data.item_ids.len(),
                            val,
                            filter: filters.clone(),
                        };
                        if deadline {
                            let mut frozen = grouping.clone();
                            frozen.group_key = Some(key.clone());
                            let mut cursor = cursor.map_filter(|filters| {
                                super::due_date::GroupedDueDateContext {
                                    filters,
                                    grouping: frozen,
                                }
                            });
                            cursor.limit = grouping
                                .per_group_limit
                                .map_or(data.item_ids.len(), |limit| limit as usize);
                            Base64Str::encode_json(cursor).type_erase()
                        } else {
                            Base64Str::encode_json(cursor).type_erase()
                        }
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
    }
}

/// One grouped task with its canonical due date from candidate selection.
#[derive(Debug)]
pub struct DueDateGroupedItem {
    /// Group placement and hydrated item.
    pub grouping: ItemGroupingInfo<SoupPropertiesField>,
    /// Canonical deadline retained through hydration.
    pub due_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Build a grouped response and contextual cursors for task due-date sorting.
/// Counts come from the pre-cursor candidate query, not the current page.
pub fn build_due_date_grouped_response(
    items: impl IntoIterator<Item = DueDateGroupedItem>,
    grouping: &GroupingConfig,
    sort: DueDateSort,
    filters: EntityFilterAst,
) -> GroupedResponse {
    use super::due_date::{GroupedDueDateContext, GroupedDueDateCursor};
    struct Data {
        item_ids: Vec<Uuid>,
        total: u32,
        last: Option<(Uuid, Option<chrono::DateTime<chrono::Utc>>, usize)>,
    }
    let mut groups: HashMap<String, Data> = HashMap::new();
    let mut pool = HashMap::new();
    for DueDateGroupedItem {
        grouping: item,
        due_at,
    } in items
    {
        let id = item.item.id();
        let entry = groups.entry(item.key).or_insert_with(|| Data {
            item_ids: Vec::new(),
            total: item.total_group_count.min(u32::MAX as usize) as u32,
            last: None,
        });
        entry.item_ids.push(id);
        entry.last = Some((id, due_at, item.index_in_group));
        pool.entry(id)
            .or_insert_with(|| EnrichedSoupItem::from(item.item));
    }
    let mut groups: Vec<GroupMeta> = groups
        .into_iter()
        .map(|(key, data)| {
            let (label, display_order) = resolve_group_label_and_order(&key, &grouping.field);
            let next_cursor = if data
                .last
                .is_some_and(|(_, _, index)| index < data.total as usize)
            {
                data.last.map(|(id, due_at, _)| {
                    let mut context_grouping = grouping.clone();
                    context_grouping.group_key = Some(key.clone());
                    let cursor: GroupedDueDateCursor = CursorWithValAndFilter {
                        id,
                        limit: grouping
                            .per_group_limit
                            .map_or(data.item_ids.len(), |limit| limit as usize),
                        val: CursorVal {
                            sort_type: sort,
                            last_val: due_at,
                        },
                        filter: GroupedDueDateContext {
                            filters: filters.clone(),
                            grouping: context_grouping,
                        },
                    };
                    Base64Str::encode_json(cursor).type_erase()
                })
            } else {
                None
            };
            GroupMeta {
                key,
                label,
                display_order,
                total_count: data.total,
                item_ids: data.item_ids,
                next_cursor,
            }
        })
        .collect();
    groups.sort_by(|a, b| {
        a.display_order
            .unwrap_or(i32::MAX)
            .cmp(&b.display_order.unwrap_or(i32::MAX))
            .then_with(|| a.key.cmp(&b.key))
    });
    let page_cursor = if grouping.group_key.is_some() {
        groups.first().and_then(|group| group.next_cursor.clone())
    } else {
        None
    };
    GroupedResponse {
        items: pool,
        groups,
        page_cursor,
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

/// Items and metadata belonging to one nested Soup group.
pub struct BinData<T = ()> {
    data: Vec<SoupItem<T>>,
    group_total_size: usize,
    next_cursor: Option<String>,
}

impl<T> BinData<T> {
    /// The total number of items in this group across all pages.
    pub fn group_total_size(&self) -> usize {
        self.group_total_size
    }

    /// Return the cursor for the next page in this bin, when one exists.
    pub fn next_cursor(&self) -> Option<&str> {
        self.next_cursor.as_deref()
    }

    /// Consume the bin and return its items in their group order.
    pub fn into_items(self) -> impl Iterator<Item = SoupItem<T>> {
        self.data.into_iter()
    }
}

/// Soup items nested into bins keyed by their grouping value.
pub struct NestedSoupGroups<T = (), Bin = String>(IndexMap<Bin, BinData<T>>);

impl<Bin, T> NestedSoupGroups<T, Bin> {
    /// Consume the nested groups and iterate over their bins.
    pub fn into_bins(self) -> impl Iterator<Item = (Bin, BinData<T>)> {
        self.0.into_iter()
    }
}

impl<T> NestedSoupGroups<T> {
    /// Attach an opaque continuation cursor to every truncated bin.
    pub fn with_next_cursors(
        mut self,
        sort_method: SimpleSortMethod,
        filters: EntityFilterAst,
    ) -> Self {
        let mut get_cursor_val = SoupItem::sort_on(sort_method);

        for bin in self.0.values_mut() {
            if bin.data.len() >= bin.group_total_size {
                continue;
            }

            bin.next_cursor = bin.data.last().map(|item| {
                let cursor: CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst> =
                    CursorWithValAndFilter {
                        id: item.id(),
                        limit: bin.data.len(),
                        val: get_cursor_val(item),
                        filter: filters.clone(),
                    };
                Base64Str::encode_json(cursor).type_erase()
            });
        }

        self
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
    /// The Soup item.
    pub item: SoupItem<T>,
}

impl<Bin, T> FromIterator<ItemGroupingInfo<T, Bin>> for NestedSoupGroups<T, Bin>
where
    Bin: Eq + std::hash::Hash,
{
    fn from_iter<I: IntoIterator<Item = ItemGroupingInfo<T, Bin>>>(iter: I) -> Self {
        let mut out = IndexMap::new();

        for item in iter {
            let ItemGroupingInfo {
                key,
                total_group_count,
                item,
                ..
            } = item;
            let entry = out.entry(key).or_insert_with(|| BinData {
                data: Vec::new(),
                group_total_size: total_group_count,
                next_cursor: None,
            });
            entry.data.push(item);
        }
        NestedSoupGroups(out)
    }
}
