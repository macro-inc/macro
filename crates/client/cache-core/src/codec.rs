//! Binary record codec shared by all persistent backends (IndexedDB,
//! SQLite). Records are stored as postcard bytes; the cache namespace embeds
//! [`CACHE_FORMAT_VERSION`] and [`meta::SCHEMA_HASH`](crate::meta) so a
//! format or schema change starts a fresh cache instead of attempting
//! migration (the cache is disposable by design).

use crate::normalize::RecordUpdates;
use crate::queue::{PersistedOptimisticLayer, StoredMutation};
use crate::value::Record;
use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;

/// Bump when the stored representation of [`Record`]/[`CacheValue`]
/// (or anything else persisted) changes incompatibly.
pub const CACHE_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum CodecError {
    #[error("corrupt cache payload: {0}")]
    Corrupt(#[from] postcard::Error),
}

fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    // Serialization of an in-memory cache value cannot fail.
    postcard::to_allocvec(value).expect("cache value serializes")
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, CodecError> {
    Ok(postcard::from_bytes(bytes)?)
}

pub fn encode_record(record: &Record) -> Vec<u8> {
    encode(record)
}

pub fn decode_record(bytes: &[u8]) -> Result<Record, CodecError> {
    decode(bytes)
}

/// Encodes one queued mutation's request and retry metadata.
pub fn encode_stored_mutation(mutation: &StoredMutation) -> Vec<u8> {
    encode(mutation)
}

/// Decodes one queued mutation's request and retry metadata.
pub fn decode_stored_mutation(bytes: &[u8]) -> Result<StoredMutation, CodecError> {
    decode(bytes)
}

/// Encodes one persisted optimistic layer.
pub fn encode_optimistic_layer(layer: &PersistedOptimisticLayer) -> Vec<u8> {
    encode(layer)
}

/// Decodes one persisted optimistic layer.
pub fn decode_optimistic_layer(bytes: &[u8]) -> Result<PersistedOptimisticLayer, CodecError> {
    decode(bytes)
}

/// Encodes normalized updates independently for relational backends.
pub fn encode_record_updates(updates: &RecordUpdates) -> Vec<u8> {
    encode(updates)
}

/// Decodes normalized updates independently for relational backends.
pub fn decode_record_updates(bytes: &[u8]) -> Result<RecordUpdates, CodecError> {
    decode(bytes)
}

/// Canonical database/namespace name for a cache instance.
/// `scope` identifies the user/workspace (host-provided).
pub fn cache_namespace(scope: &str) -> String {
    format!(
        "graphql-cache:{scope}:{}:v{CACHE_FORMAT_VERSION}",
        &crate::meta::SCHEMA_HASH[..12]
    )
}

/// Stable physical database name for a cache scope.
///
/// Unlike [`cache_namespace`], this deliberately excludes the record schema
/// and format versions. Normalized records are disposable on version changes,
/// while queued mutations represent user intent and must remain discoverable.
pub fn cache_database_name(scope: &str) -> String {
    format!("graphql-cache:{scope}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value::{CacheNumber, CacheValue, EntityKey};

    #[test]
    fn round_trips() {
        let mut record = Record::default();
        record.fields.insert(
            "__typename".into(),
            CacheValue::String("GraphqlSoupDocument".into()),
        );
        record.fields.insert(
            "properties".into(),
            CacheValue::List(vec![CacheValue::Object(
                [("kind".to_string(), CacheValue::String("Boolean".into()))].into(),
            )]),
        );
        record.fields.insert(
            "project".into(),
            CacheValue::Ref(EntityKey("GraphqlSoupProject:p1".into())),
        );
        record.fields.insert(
            "metadata".into(),
            CacheValue::opaque(&serde_json::json!({"a": [1, 2.5, null]})),
        );
        record
            .fields
            .insert("count".into(), CacheValue::Number(CacheNumber::PosInt(42)));

        let bytes = encode_record(&record);
        let decoded = decode_record(&bytes).unwrap();
        assert_eq!(decoded, record);
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_record(&[0xff, 0x00, 0x13, 0x37]).is_err());
    }

    #[test]
    fn namespace_shape() {
        let ns = cache_namespace("user-1");
        assert!(ns.starts_with("graphql-cache:user-1:"));
        assert!(ns.ends_with(":v1"));
    }
}
