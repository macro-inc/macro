//! Binary record codec shared by all persistent Turso backends (browser and
//! native hosts). Records are stored as postcard bytes; the logical namespace
//! embeds [`CACHE_FORMAT_VERSION`] and [`CACHE_SCHEMA_COMPATIBILITY_EPOCH`],
//! and so does the browser's physical database name. A healthy, graceful
//! browser reopen with matching versions preserves records, queued mutations,
//! and optimistic layers. A compatibility/format mismatch or abrupt/uncertain
//! browser owner loss physically resets the database and discards all three.

use crate::normalize::RecordUpdates;
use crate::queue::{PersistedOptimisticLayer, StoredMutation};
use crate::value::Record;
use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;

/// Bump when the stored representation of [`Record`]/[`CacheValue`]
/// (or anything else persisted) changes incompatibly.
pub const CACHE_FORMAT_VERSION: u32 = 3;

/// Bump when a GraphQL schema change makes existing normalized records unsafe.
///
/// Additive fields do not require a bump: fragment reads only project selected
/// fields, so older records remain usable until a newly selected field is
/// fetched. Bump this epoch for incompatible changes to normalized identity,
/// field storage shape, or other schema-derived cache semantics.
// File-type facts now preserve raw server text instead of enum-normalizing it.
pub const CACHE_SCHEMA_COMPATIBILITY_EPOCH: u32 = 3;

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

/// Canonical logical namespace for a cache instance.
///
/// `scope` is an anonymous, client-generated token supplied by the host. It is
/// neither user nor workspace identity.
pub fn cache_namespace(scope: &str) -> String {
    format!("graphql-cache:{scope}:s{CACHE_SCHEMA_COMPATIBILITY_EPOCH}:v{CACHE_FORMAT_VERSION}")
}

/// Physical database name for a cache scope at one storage version.
///
/// It embeds the schema compatibility epoch, the cache format version, and the
/// backend's `storage_schema_version`, so builds that cannot share records use
/// separate files and owner locks instead of resetting each other's database
/// while tabs of both stay open after a deploy. Builds with matching versions
/// share one database: only a healthy, graceful close and reopen preserves its
/// files. Metadata is still validated on open, and a mismatch or an
/// abrupt/uncertain owner loss physically resets both files, discarding every
/// row, including queued mutations and optimistic layers.
pub fn cache_database_name(scope: &str, storage_schema_version: u32) -> String {
    format!(
        "{}:s{CACHE_SCHEMA_COMPATIBILITY_EPOCH}.v{CACHE_FORMAT_VERSION}.t{storage_schema_version}",
        legacy_cache_database_name(scope)
    )
}

/// Physical name every storage version shared before [`cache_database_name`]
/// embedded versions; kept so stale files can be found and removed.
pub fn legacy_cache_database_name(scope: &str) -> String {
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
    fn namespace_uses_schema_compatibility_epoch_not_schema_hash() {
        assert_eq!(
            cache_namespace("client-token-1"),
            "graphql-cache:client-token-1:s3:v3"
        );
    }

    #[test]
    fn database_name_separates_storage_versions() {
        assert_eq!(
            cache_database_name("client-token-1", 11),
            "graphql-cache:client-token-1:s3.v3.t11"
        );
        assert_ne!(
            cache_database_name("client-token-1", 12),
            cache_database_name("client-token-1", 11)
        );
        assert_eq!(
            legacy_cache_database_name("client-token-1"),
            "graphql-cache:client-token-1"
        );
    }
}
