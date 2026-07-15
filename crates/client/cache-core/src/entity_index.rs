//! Secondary-index metadata derived from normalized Soup entity records.
//!
//! Normalized records remain authoritative. Storage backends persist this
//! small projection alongside each encoded record so they can order and
//! filter Quick Access entities without inspecting the record blob.

use crate::value::{CacheValue, EntityKey, Record};
use chrono::DateTime;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::Error as _};
use serde_json::Value as Json;
use std::str::FromStr;
use thiserror::Error;

/// Quick Access bucket attached to an indexed normalized entity record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityBucket {
    /// A regular non-note document.
    Document,
    /// A markdown note document.
    Note,
    /// A task document.
    Task,
    /// A snippet document.
    Snippet,
    /// An AI chat.
    Chat,
    /// A project.
    Project,
    /// An email thread.
    Email,
    /// A non-direct-message channel.
    Channel,
    /// A direct-message channel.
    Dm,
    /// A CRM company.
    CrmCompany,
}

impl EntityBucket {
    /// Stable persisted representation of the bucket.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Note => "note",
            Self::Task => "task",
            Self::Snippet => "snippet",
            Self::Chat => "chat",
            Self::Project => "project",
            Self::Email => "email",
            Self::Channel => "channel",
            Self::Dm => "dm",
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
            "note" => Ok(Self::Note),
            "task" => Ok(Self::Task),
            "snippet" => Ok(Self::Snippet),
            "chat" => Ok(Self::Chat),
            "project" => Ok(Self::Project),
            "email" => Ok(Self::Email),
            "channel" => Ok(Self::Channel),
            "dm" => Ok(Self::Dm),
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

fn encode_cursor(cursor: &EntityIndexCursor) -> String {
    let key = cursor
        .entity_key
        .0
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{}.{key}", cursor.sort_timestamp)
}

fn decode_cursor(value: &str) -> Result<EntityIndexCursor, String> {
    let (timestamp, encoded_key) = value
        .split_once('.')
        .ok_or_else(|| "invalid entity index cursor".to_string())?;
    if encoded_key.len() % 2 != 0 {
        return Err("invalid entity index cursor".to_string());
    }
    let key_bytes = encoded_key
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| "invalid entity index cursor")?;
            u8::from_str_radix(pair, 16).map_err(|_| "invalid entity index cursor")
        })
        .collect::<Result<Vec<_>, _>>()?;
    let entity_key = String::from_utf8(key_bytes).map_err(|_| "invalid entity index cursor")?;
    let sort_timestamp = timestamp
        .parse::<i64>()
        .map_err(|_| "invalid entity index cursor")?;
    Ok(EntityIndexCursor {
        sort_timestamp,
        entity_key: EntityKey(entity_key),
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
/// unindexed. Task and snippet subtypes take precedence over file type;
/// otherwise markdown documents use the `note` bucket.
pub fn record_index_metadata(key: &EntityKey, record: &Record) -> Option<RecordIndexMetadata> {
    if key.is_root() || is_deleted(record) {
        return None;
    }

    let typename = record.typename()?;
    let bucket = match typename {
        "GraphqlSoupDocument" => document_bucket(record),
        "GraphqlSoupChat" => EntityBucket::Chat,
        "GraphqlSoupProject" => EntityBucket::Project,
        "GraphqlSoupEmailThread" => EntityBucket::Email,
        "GraphqlSoupChannel" => channel_bucket(record),
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

fn is_deleted(record: &Record) -> bool {
    !matches!(
        record.fields.get("deletedAt"),
        None | Some(CacheValue::Null)
    )
}

fn document_bucket(record: &Record) -> EntityBucket {
    let kind = match record.fields.get("subType") {
        Some(CacheValue::Object(fields)) => match fields.get("kind") {
            Some(CacheValue::String(kind)) => Some(kind.as_str()),
            _ => None,
        },
        _ => None,
    };

    match kind {
        Some(kind) if kind.eq_ignore_ascii_case("task") => EntityBucket::Task,
        Some(kind) if kind.eq_ignore_ascii_case("snippet") => EntityBucket::Snippet,
        _ => match record.fields.get("fileType") {
            Some(CacheValue::String(file_type)) if file_type.eq_ignore_ascii_case("md") => {
                EntityBucket::Note
            }
            _ => EntityBucket::Document,
        },
    }
}

fn channel_bucket(record: &Record) -> EntityBucket {
    match record.fields.get("channelType") {
        Some(CacheValue::String(channel_type))
            if channel_type.eq_ignore_ascii_case("direct_message") =>
        {
            EntityBucket::Dm
        }
        _ => EntityBucket::Channel,
    }
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
