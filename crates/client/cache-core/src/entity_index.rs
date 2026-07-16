//! Secondary-index metadata derived from normalized Soup entity records.
//!
//! Normalized records remain authoritative. Storage backends persist this
//! small projection alongside each encoded record so they can order and
//! filter Quick Access entities without inspecting the record blob.

use crate::value::{CacheValue, EntityKey, Record};
use chrono::DateTime;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use serde_json::Value as Json;
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::str::FromStr;
use thiserror::Error;

/// Quick Access bucket attached to an indexed normalized entity record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityBucket {
    /// A document, including notes, tasks, and snippets.
    Document,
    /// An AI chat.
    Chat,
    /// A project.
    Project,
    /// An email thread.
    Email,
    /// A channel, including direct messages.
    Channel,
    /// A CRM company.
    CrmCompany,
}

impl EntityBucket {
    /// Every indexed entity type.
    pub const ALL: [Self; 6] = [
        Self::Document,
        Self::Chat,
        Self::Project,
        Self::Email,
        Self::Channel,
        Self::CrmCompany,
    ];

    /// Stable persisted representation of the bucket.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Chat => "chat",
            Self::Project => "project",
            Self::Email => "email",
            Self::Channel => "channel",
            Self::CrmCompany => "crm_company",
        }
    }
}

/// Error returned when persisted index metadata contains an unknown bucket.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("unknown entity bucket `{0}`")]
pub struct ParseEntityBucketError(String);

impl FromStr for EntityBucket {
    type Err = ParseEntityBucketError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "document" => Ok(Self::Document),
            "chat" => Ok(Self::Chat),
            "project" => Ok(Self::Project),
            "email" => Ok(Self::Email),
            "channel" => Ok(Self::Channel),
            "crm_company" => Ok(Self::CrmCompany),
            _ => Err(ParseEntityBucketError(value.to_string())),
        }
    }
}

/// Cursor into the deterministic entity-index ordering.
///
/// The wire representation is an opaque string; storage details never cross
/// into frontend APIs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityIndexCursor {
    /// Timestamp of the last item returned by the preceding page.
    pub sort_timestamp: i64,
    /// Entity key of the last item returned by the preceding page.
    pub entity_key: EntityKey,
}

impl Serialize for EntityIndexCursor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&encode_cursor(self))
    }
}

impl<'de> Deserialize<'de> for EntityIndexCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        decode_cursor(&value).map_err(D::Error::custom)
    }
}

fn encode_entity_key(entity_key: &EntityKey) -> String {
    entity_key
        .0
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_entity_key(encoded: &str) -> Result<EntityKey, String> {
    if !encoded.len().is_multiple_of(2) {
        return Err("invalid entity index cursor".to_string());
    }
    let bytes = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| "invalid entity index cursor")?;
            u8::from_str_radix(pair, 16).map_err(|_| "invalid entity index cursor")
        })
        .collect::<Result<Vec<_>, _>>()?;
    String::from_utf8(bytes)
        .map(EntityKey)
        .map_err(|_| "invalid entity index cursor".to_string())
}

fn encode_cursor(cursor: &EntityIndexCursor) -> String {
    format!(
        "{}.{}",
        cursor.sort_timestamp,
        encode_entity_key(&cursor.entity_key)
    )
}

fn decode_cursor(value: &str) -> Result<EntityIndexCursor, String> {
    let (timestamp, encoded_key) = value
        .split_once('.')
        .ok_or_else(|| "invalid entity index cursor".to_string())?;
    let entity_key = decode_entity_key(encoded_key)?;
    let sort_timestamp = timestamp
        .parse::<i64>()
        .map_err(|_| "invalid entity index cursor")?;
    Ok(EntityIndexCursor {
        sort_timestamp,
        entity_key,
    })
}

/// Maximum number of indexed entities returned by one cache query.
pub const MAX_ENTITY_INDEX_PAGE_SIZE: usize = 500;

/// Cache-only query over indexed normalized entity records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityIndexQuery {
    /// Buckets to include. An empty list means every indexed bucket.
    pub buckets: Vec<EntityBucket>,
    /// Exclusive cursor from a preceding page.
    pub cursor: Option<EntityIndexCursor>,
    /// Requested maximum number of index entries. Storage and engine
    /// implementations clamp this to [`MAX_ENTITY_INDEX_PAGE_SIZE`].
    pub limit: usize,
    /// Whether this page should include the total number of matching rows.
    pub include_total_count: bool,
}

impl EntityIndexQuery {
    /// Page size after applying the cache-wide safety bound.
    pub fn bounded_limit(&self) -> usize {
        self.limit.min(MAX_ENTITY_INDEX_PAGE_SIZE)
    }

    /// Storage read bound, allowing one extra row for `has_more` detection.
    pub fn bounded_storage_limit(&self) -> usize {
        self.limit.min(MAX_ENTITY_INDEX_PAGE_SIZE.saturating_add(1))
    }
}

/// One ordered row from the normalized-record secondary index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityIndexEntry {
    /// Normalized cache entity key.
    pub entity_key: EntityKey,
    /// Quick Access bucket projected from the record.
    pub bucket: EntityBucket,
    /// Recency timestamp in Unix milliseconds.
    pub sort_timestamp: i64,
}

/// Frontend-readable snapshot of one indexed normalized entity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEntityItem {
    /// Entity identifier from the normalized record.
    pub id: String,
    /// Quick Access bucket projected from the durable record.
    pub bucket: EntityBucket,
    /// Recency timestamp in Unix milliseconds.
    pub sort_timestamp: i64,
    /// Scalar and embedded-object fields currently present on the record.
    /// Links to other normalized records are intentionally omitted.
    pub entity: Json,
}

/// One page returned by [`crate::engine::Engine::query_indexed_items`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEntityPage {
    /// Decoded entity snapshots in index order.
    pub items: Vec<IndexedEntityItem>,
    /// Cursor to pass to the next request when [`Self::has_more`] is true.
    pub next_cursor: Option<EntityIndexCursor>,
    /// Whether another indexed page exists after this one.
    pub has_more: bool,
    /// Total rows across the selected buckets when requested.
    pub total_count: Option<u64>,
    /// Per-entity-type totals when requested.
    pub bucket_counts: Option<BTreeMap<EntityBucket, u64>>,
}

/// Opaque cursor into relevance, recency, and entity-key search ordering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntitySearchCursor {
    /// Relevance score of the last returned entity.
    pub score: i64,
    /// Recency timestamp of the last returned entity.
    pub sort_timestamp: i64,
    /// Entity key of the last returned entity.
    pub entity_key: EntityKey,
}

impl Serialize for EntitySearchCursor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&format!(
            "{}.{}.{}",
            self.score,
            self.sort_timestamp,
            encode_entity_key(&self.entity_key)
        ))
    }
}

impl<'de> Deserialize<'de> for EntitySearchCursor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        let mut parts = value.splitn(3, '.');
        let score = parts
            .next()
            .and_then(|part| part.parse::<i64>().ok())
            .ok_or_else(|| D::Error::custom("invalid entity search cursor"))?;
        let sort_timestamp = parts
            .next()
            .and_then(|part| part.parse::<i64>().ok())
            .ok_or_else(|| D::Error::custom("invalid entity search cursor"))?;
        let entity_key = parts
            .next()
            .ok_or_else(|| D::Error::custom("invalid entity search cursor"))
            .and_then(|part| decode_entity_key(part).map_err(D::Error::custom))?;
        Ok(Self {
            score,
            sort_timestamp,
            entity_key,
        })
    }
}

/// Cache-side search over projected normalized entity metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntitySearchQuery {
    /// Buckets to include. Empty means every indexed bucket.
    pub buckets: Vec<EntityBucket>,
    /// User-entered search text.
    pub query: String,
    /// Exclusive cursor from a preceding search page.
    pub cursor: Option<EntitySearchCursor>,
    /// Requested maximum page size.
    pub limit: usize,
    /// Whether the result should include the total number of matches.
    pub include_total_count: bool,
}

impl EntitySearchQuery {
    /// Page size after applying the cache-wide safety bound.
    pub fn bounded_limit(&self) -> usize {
        self.limit.min(MAX_ENTITY_INDEX_PAGE_SIZE)
    }

    /// Adapter result bound, including one extra match for `has_more`.
    pub fn bounded_storage_limit(&self) -> usize {
        self.bounded_limit().saturating_add(1)
    }
}

/// One matching index entry ordered by relevance and recency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntitySearchEntry {
    /// Normalized entity key.
    pub entity_key: EntityKey,
    /// Projected entity bucket.
    pub bucket: EntityBucket,
    /// Recency timestamp in Unix milliseconds.
    pub sort_timestamp: i64,
    /// Shared cache-core relevance score.
    pub score: i64,
}

/// Bounded adapter result for an entity search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntitySearchIndexResult {
    /// At most the requested number of ordered matching entries.
    pub entries: Vec<EntitySearchEntry>,
    /// Total matches when requested.
    pub total_count: Option<u64>,
    /// Per-entity-type match totals when requested.
    pub bucket_counts: Option<BTreeMap<EntityBucket, u64>>,
}

/// One hydrated search page returned across cache host boundaries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEntitySearchPage {
    /// Hydrated matching entities in relevance order.
    pub items: Vec<IndexedEntityItem>,
    /// Cursor for the next page.
    pub next_cursor: Option<EntitySearchCursor>,
    /// Whether another search page exists.
    pub has_more: bool,
    /// Total matching entities when requested.
    pub total_count: Option<u64>,
    /// Per-entity-type match totals when requested.
    pub bucket_counts: Option<BTreeMap<EntityBucket, u64>>,
}

/// Optional index columns persisted alongside one encoded record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordIndexMetadata {
    /// Entity bucket used for filtering.
    pub bucket: EntityBucket,
    /// Recency timestamp in Unix milliseconds.
    pub sort_timestamp: i64,
}

/// Derives Quick Access index metadata from a fully merged normalized record.
///
/// Unsupported entities, people, calls, and tombstoned records are left
/// unindexed. Document and channel subtypes remain fields on their normalized
/// records rather than becoming cache-index entity types.
pub fn record_index_metadata(key: &EntityKey, record: &Record) -> Option<RecordIndexMetadata> {
    if key.is_root() || is_deleted(record) {
        return None;
    }

    let typename = record.typename()?;
    let bucket = match typename {
        "GraphqlSoupDocument" => EntityBucket::Document,
        "GraphqlSoupChat" => EntityBucket::Chat,
        "GraphqlSoupProject" => EntityBucket::Project,
        "GraphqlSoupEmailThread" => EntityBucket::Email,
        "GraphqlSoupChannel" => EntityBucket::Channel,
        "GraphqlSoupCrmCompany" => EntityBucket::CrmCompany,
        _ => return None,
    };

    let timestamp_fields: &[&str] = match typename {
        "GraphqlSoupEmailThread" => &["viewedAt", "sortTs", "updatedAt", "createdAt"],
        "GraphqlSoupChannel" => &["viewedAt", "interactedAt", "updatedAt", "createdAt"],
        _ => &["viewedAt", "updatedAt", "createdAt"],
    };
    let sort_timestamp = timestamp_fields
        .iter()
        .find_map(|field| timestamp(record, field))
        .unwrap_or_default();

    Some(RecordIndexMetadata {
        bucket,
        sort_timestamp,
    })
}

fn string_field<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) => Some(value),
        _ => None,
    }
}

fn append_string_field(parts: &mut Vec<String>, record: &Record, field: &str) {
    if let Some(value) = string_field(record, field)
        && !value.trim().is_empty()
    {
        parts.push(value.to_string());
    }
}

fn append_string_list(parts: &mut Vec<String>, record: &Record, field: &str) {
    let Some(CacheValue::List(values)) = record.fields.get(field) else {
        return;
    };
    parts.extend(values.iter().filter_map(|value| match value {
        CacheValue::String(value) if !value.trim().is_empty() => Some(value.clone()),
        _ => None,
    }));
}

/// Projects searchable scalar text directly from a normalized entity record.
pub fn record_search_text(record: &Record) -> Option<String> {
    let typename = record.typename()?;
    let mut parts = Vec::new();
    match typename {
        "GraphqlSoupDocument" => append_string_field(&mut parts, record, "documentName"),
        "GraphqlSoupChat" => append_string_field(&mut parts, record, "chatName"),
        "GraphqlSoupProject" => append_string_field(&mut parts, record, "projectName"),
        "GraphqlSoupEmailThread" => {
            for field in ["emailName", "senderName", "senderEmail", "snippet"] {
                append_string_field(&mut parts, record, field);
            }
        }
        "GraphqlSoupChannel" => append_string_field(&mut parts, record, "channelName"),
        "GraphqlSoupCrmCompany" => {
            append_string_field(&mut parts, record, "crmCompanyName");
            append_string_field(&mut parts, record, "description");
            append_string_list(&mut parts, record, "domains");
        }
        _ => return None,
    }
    // Support normalized responses that used a GraphQL alias for the name.
    append_string_field(&mut parts, record, "name");
    Some(parts.join(" "))
}

/// Lower-cased non-empty terms used by every storage search implementation.
pub fn normalized_search_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect()
}

/// Computes a deterministic relevance score for projected search text.
///
/// Every query term must occur as a case-insensitive substring. Exact,
/// leading, and word-prefix matches rank above later substring matches.
pub fn entity_search_score(search_text: &str, query: &str) -> Option<i64> {
    let terms = normalized_search_terms(query);
    if terms.is_empty() {
        return Some(0);
    }
    let text = search_text.to_lowercase();
    let mut position_penalty = 0_i64;
    for term in &terms {
        let position = text.find(term)?;
        position_penalty = position_penalty.saturating_add(position as i64);
    }

    let normalized_query = terms.join(" ");
    let base = if text == normalized_query {
        1_000_000
    } else if text.starts_with(&normalized_query) {
        900_000
    } else if text
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| word.starts_with(&normalized_query))
    {
        800_000
    } else {
        700_000
    };
    Some(
        base - position_penalty.saturating_mul(100)
            - i64::try_from(text.len().min(10_000)).unwrap_or(10_000),
    )
}

/// Comparator for relevance DESC, recency DESC, entity key ASC.
pub fn entity_search_entry_order(left: &EntitySearchEntry, right: &EntitySearchEntry) -> Ordering {
    right
        .score
        .cmp(&left.score)
        .then_with(|| right.sort_timestamp.cmp(&left.sort_timestamp))
        .then_with(|| left.entity_key.cmp(&right.entity_key))
}

/// Whether an entry occurs strictly after an opaque search cursor.
pub fn entity_search_entry_after_cursor(
    entry: &EntitySearchEntry,
    cursor: Option<&EntitySearchCursor>,
) -> bool {
    cursor.is_none_or(|cursor| {
        entry.score < cursor.score
            || (entry.score == cursor.score
                && (entry.sort_timestamp < cursor.sort_timestamp
                    || (entry.sort_timestamp == cursor.sort_timestamp
                        && entry.entity_key > cursor.entity_key)))
    })
}

/// Retains only the best `limit` entries while an adapter streams matches.
pub fn push_bounded_search_entry(
    entries: &mut Vec<EntitySearchEntry>,
    entry: EntitySearchEntry,
    limit: usize,
) {
    if limit == 0 {
        return;
    }
    if entries.len() < limit {
        entries.push(entry);
        return;
    }
    let Some((worst_index, worst)) = entries
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| entity_search_entry_order(left, right))
    else {
        return;
    };
    if entity_search_entry_order(&entry, worst) == Ordering::Less {
        entries[worst_index] = entry;
    }
}

/// Sorts a bounded adapter result into the shared search order.
pub fn sort_search_entries(entries: &mut [EntitySearchEntry]) {
    entries.sort_by(entity_search_entry_order);
}

fn is_deleted(record: &Record) -> bool {
    !matches!(
        record.fields.get("deletedAt"),
        None | Some(CacheValue::Null)
    )
}

fn timestamp(record: &Record, field: &str) -> Option<i64> {
    let CacheValue::String(value) = record.fields.get(field)? else {
        return None;
    };
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

pub(crate) fn indexed_entity_item(
    entry: EntityIndexEntry,
    record: &Record,
) -> Option<IndexedEntityItem> {
    let CacheValue::String(id) = record.fields.get("id")? else {
        return None;
    };
    let entity = Json::Object(
        record
            .fields
            .iter()
            .filter_map(|(field, value)| {
                cache_value_snapshot(value).map(|value| (field.clone(), value))
            })
            .collect(),
    );

    Some(IndexedEntityItem {
        id: id.clone(),
        bucket: entry.bucket,
        sort_timestamp: entry.sort_timestamp,
        entity,
    })
}

fn cache_value_snapshot(value: &CacheValue) -> Option<Json> {
    match value {
        CacheValue::Null => Some(Json::Null),
        CacheValue::Bool(value) => Some(Json::Bool(*value)),
        CacheValue::Number(value) => Some(Json::Number(value.to_json())),
        CacheValue::String(value) => Some(Json::String(value.clone())),
        CacheValue::Ref(_) => None,
        CacheValue::Object(fields) => Some(Json::Object(
            fields
                .iter()
                .filter_map(|(field, value)| {
                    cache_value_snapshot(value).map(|value| (field.clone(), value))
                })
                .collect(),
        )),
        CacheValue::List(values) => values
            .iter()
            .map(cache_value_snapshot)
            .collect::<Option<Vec<_>>>()
            .map(Json::Array),
        CacheValue::Opaque(value) => serde_json::from_str(value).ok(),
    }
}

#[cfg(test)]
mod test;
