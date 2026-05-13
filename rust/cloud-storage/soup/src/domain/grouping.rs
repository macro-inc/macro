//! In-memory grouping of soup items with per-group limits and pagination.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use models_grouping::{
    GroupByField, GroupingConfig, compute_date_bucket, date_bucket_label, date_bucket_order,
};
use models_pagination::{SimpleSortMethod, SortOn};
use models_soup::item::SoupItem;
use thiserror::Error;

use crate::domain::models::{FrecencySoupItem, GroupMeta};

#[derive(Debug, Error)]
pub enum GroupingError {
    #[error("Invalid cursor: {0}")]
    InvalidCursor(String),

    #[error("Invalid grouping config: {0}")]
    InvalidConfig(String),
}

/// Items ordered by group, then by sort order within each group.
#[derive(Debug)]
pub struct GroupedResponse {
    pub items: Vec<GroupedItem>,
    pub groups: Vec<GroupMeta>,
    pub next_cursor: Option<GroupedCursor>,
}

/// A soup item with its group assignment.
#[derive(Debug)]
pub struct GroupedItem {
    pub item: FrecencySoupItem,
    pub group_key: String,
    pub group_label: String,
    /// Lower = displayed first.
    pub group_display_order: i32,
}

/// Keyset-based cursor for grouped pagination. Tracks position within each group.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct GroupedCursor {
    pub groups: std::collections::HashMap<String, GroupKeyset>,
}

/// Keyset state for a single group, enabling stable pagination.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GroupKeyset {
    pub last_id: String,
    pub last_sort_ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy)]
pub struct GroupedPaginationLimits {
    pub per_group: u32,
    pub total: u32,
}

impl Default for GroupedPaginationLimits {
    fn default() -> Self {
        Self {
            per_group: 10,
            total: 100,
        }
    }
}

pub fn group_items(
    items: Vec<FrecencySoupItem>,
    config: &GroupingConfig,
    cursor: Option<&GroupedCursor>,
    limits: GroupedPaginationLimits,
    sort_method: SimpleSortMethod,
) -> Result<GroupedResponse, GroupingError> {
    // Compute counts from items (no external count source)
    let mut counts: HashMap<String, u32> = HashMap::new();
    for item in &items {
        let key = compute_group_key(&item.item, &config.field);
        *counts.entry(key).or_default() += 1;
    }
    Ok(group_items_with_counts(
        items,
        &counts,
        config,
        cursor,
        limits,
        sort_method,
    ))
}

pub fn compute_group_key(item: &SoupItem, field: &GroupByField) -> String {
    match field {
        GroupByField::Date => compute_date_bucket(item.updated_at()).to_string(),
        GroupByField::EntityType => item.entity_type_str().to_string(),
        GroupByField::Project => item
            .project_id()
            .map(|id| id.to_string())
            .unwrap_or_default(),
        GroupByField::Property {
            property_definition_id,
            ..
        } => {
            let props = match item {
                SoupItem::Document(d) => &d.properties,
                SoupItem::Chat(c) => &c.properties,
                SoupItem::Project(p) => &p.properties,
                SoupItem::EmailThread(e) => &e.properties,
                SoupItem::Channel(_) | SoupItem::Call(_) => return String::new(),
            };
            props
                .iter()
                .find(|p| p.definition.id == *property_definition_id)
                .and_then(|p| p.value.as_ref())
                .map(property_value_to_group_key)
                .unwrap_or_default()
        }
    }
}

fn property_value_to_group_key(
    value: &models_properties::service::property_value::PropertyValue,
) -> String {
    use models_properties::service::property_value::PropertyValue;
    match value {
        PropertyValue::Bool(b) => b.to_string(),
        PropertyValue::Num(n) => n.to_string(),
        PropertyValue::Str(s) => s.clone(),
        PropertyValue::Date(d) => d.to_rfc3339(),
        // For select options, use the first option's UUID as the key
        PropertyValue::SelectOption(opts) => {
            opts.first().map(|u| u.to_string()).unwrap_or_default()
        }
        PropertyValue::EntityRef(refs) => refs
            .first()
            .map(|r| r.entity_id.clone())
            .unwrap_or_default(),
        PropertyValue::Link(links) => links.first().cloned().unwrap_or_default(),
    }
}

fn group_display_order(key: &str, field: &GroupByField) -> i32 {
    match field {
        GroupByField::Date => date_bucket_order(key),
        GroupByField::EntityType => match key {
            "document" => 0,
            "chat" => 1,
            "project" => 2,
            "email_thread" => 3,
            "channel" => 4,
            "call" => 5,
            _ => 99,
        },
        GroupByField::Project => 0,
        GroupByField::Property { .. } => 0,
    }
}

fn group_label(key: &str, field: &GroupByField) -> String {
    match field {
        GroupByField::Date => date_bucket_label(key).to_string(),
        GroupByField::EntityType => match key {
            "document" => "Documents",
            "chat" => "Chats",
            "project" => "Projects",
            "email_thread" => "Emails",
            "channel" => "Channels",
            "call" => "Calls",
            _ => key,
        }
        .to_string(),
        GroupByField::Project => {
            if key.is_empty() {
                "No Project".to_string()
            } else {
                key.to_string()
            }
        }
        GroupByField::Property { .. } => {
            if key.is_empty() {
                "No Value".to_string()
            } else {
                key.to_string()
            }
        }
    }
}

fn encode_group_keyset(group_key: &str, keyset: &GroupKeyset) -> String {
    let payload = serde_json::json!({
        "g": group_key,
        "id": keyset.last_id,
        "ts": keyset.last_sort_ts.timestamp_millis()
    });
    URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes())
}

/// Group items using pre-fetched counts for accurate totals.
pub fn group_items_with_counts(
    items: Vec<FrecencySoupItem>,
    counts: &HashMap<String, u32>,
    config: &GroupingConfig,
    cursor: Option<&GroupedCursor>,
    limits: GroupedPaginationLimits,
    sort_method: SimpleSortMethod,
) -> GroupedResponse {
    let items_with_keys: Vec<(FrecencySoupItem, String)> = items
        .into_iter()
        .map(|item| {
            let key = compute_group_key(&item.item, &config.field);
            (item, key)
        })
        .collect();

    let items_with_keys = if let Some(target_key) = &config.group_key {
        items_with_keys
            .into_iter()
            .filter(|(_, key)| key == target_key)
            .collect()
    } else {
        items_with_keys
    };

    let mut groups: HashMap<String, Vec<FrecencySoupItem>> = HashMap::new();
    for (item, key) in items_with_keys {
        groups.entry(key).or_default().push(item);
    }

    let mut sorted_groups: Vec<(String, Vec<FrecencySoupItem>)> = groups.into_iter().collect();
    sorted_groups.sort_by_key(|(key, _)| group_display_order(key, &config.field));

    let per_group_limit = limits.per_group as usize;
    let mut result_items: Vec<GroupedItem> = Vec::new();
    let mut group_metas: Vec<GroupMeta> = Vec::new();

    // Start fresh - only keep cursor entries for groups that still have more items
    let mut next_cursor_groups: HashMap<String, GroupKeyset> = HashMap::new();

    let group_keysets = cursor.map(|c| &c.groups);

    for (key, mut items) in sorted_groups {
        let total_count = counts
            .get(&key)
            .copied()
            .unwrap_or(0)
            .max(items.len() as u32);
        let label = group_label(&key, &config.field);
        let display_order = group_display_order(&key, &config.field);

        let mut sort_fn = SoupItem::sort_on(sort_method);
        items.sort_by(|a, b| {
            let ts_cmp = sort_fn(&b.item).last_val.cmp(&sort_fn(&a.item).last_val);
            if ts_cmp == std::cmp::Ordering::Equal {
                b.item.entity().entity_id.cmp(&a.item.entity().entity_id)
            } else {
                ts_cmp
            }
        });

        let keyset = group_keysets.and_then(|g| g.get(&key));
        let page_items: Vec<_> = items
            .into_iter()
            .filter(|item| {
                let Some(ks) = keyset else { return true };
                let item_ts = sort_fn(&item.item).last_val;
                let item_id = &*item.item.entity().entity_id;
                item_ts < ks.last_sort_ts
                    || (item_ts == ks.last_sort_ts && item_id < ks.last_id.as_str())
            })
            .take(per_group_limit)
            .collect();

        let page_count = page_items.len() as u32;
        let start_index = result_items.len() as u32;

        // has_more if we hit the per-group limit. If page_count < per_group, we've exhausted
        // this group. If page_count == per_group, assume more items may exist (even if DB
        // count failed and total_count equals page_count due to fallback).
        let has_more = page_count >= limits.per_group;

        let next_group_cursor = if has_more {
            page_items.last().map(|item| GroupKeyset {
                last_id: item.item.entity().entity_id.to_string(),
                last_sort_ts: sort_fn(&item.item).last_val,
            })
        } else {
            None
        };

        if let Some(ref ks) = next_group_cursor {
            next_cursor_groups.insert(key.clone(), ks.clone());
        }

        for item in page_items {
            result_items.push(GroupedItem {
                item,
                group_key: key.clone(),
                group_label: label.clone(),
                group_display_order: display_order,
            });

            if result_items.len() >= limits.total as usize {
                break;
            }
        }

        group_metas.push(GroupMeta {
            key: key.clone(),
            label,
            display_order: Some(display_order),
            total_count,
            page_count,
            start_index,
            next_cursor: next_group_cursor.map(|ks| encode_group_keyset(&key, &ks)),
        });

        if result_items.len() >= limits.total as usize {
            break;
        }
    }

    let has_more_global = !next_cursor_groups.is_empty();
    let next_cursor = if has_more_global {
        Some(GroupedCursor {
            groups: next_cursor_groups,
        })
    } else {
        None
    };

    GroupedResponse {
        items: result_items,
        groups: group_metas,
        next_cursor,
    }
}
