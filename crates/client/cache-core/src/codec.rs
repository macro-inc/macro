//! Binary record codec shared by all persistent Turso backends (browser and
//! native hosts). Records are stored as tagged postcard bytes — raw, or
//! deflated when that is smaller — while every other persisted payload stays
//! plain postcard. The logical namespace
//! embeds [`CACHE_FORMAT_VERSION`] and [`CACHE_SCHEMA_COMPATIBILITY_EPOCH`],
//! and so does the browser's physical database name after
//! [`UNVERSIONED_STORAGE_VERSIONS`]. A healthy, graceful
//! browser reopen with matching versions preserves records, queued mutations,
//! and optimistic layers. A compatibility/format mismatch or abrupt/uncertain
//! browser owner loss physically resets the database and discards all three.

use crate::normalize::RecordUpdates;
use crate::queue::{PersistedOptimisticLayer, StoredMutation};
use crate::value::Record;
use miniz_oxide::{deflate, inflate};
use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;

/// Bump when the stored representation of [`Record`]/[`CacheValue`]
/// (or anything else persisted) changes incompatibly.
pub const CACHE_FORMAT_VERSION: u32 = 4;

/// Records at or above this size may be stored deflated. Smaller payloads stay
/// raw so deflate framing never makes them larger.
const RECORD_COMPRESSION_MIN_BYTES: usize = 256;

/// Deflate level for record payloads.
///
/// On a 155 MB sample of real records, level 6 buys 2% more compression than
/// level 3 (3.29x vs 3.22x) but costs 36% more CPU in the slowest batches, and
/// deflate runs while the cache engine lock is held. Level 3 keeps the size win
/// without stalling other cache operations behind a large record.
const RECORD_DEFLATE_LEVEL: u8 = 3;

/// Upper bound for one inflated record. Real records are a few hundred KiB at
/// most; the bound turns a corrupt length prefix into a codec error.
const RECORD_MAX_INFLATED_BYTES: usize = 64 * 1024 * 1024;

const RECORD_ENCODING_RAW: u8 = 0;
const RECORD_ENCODING_DEFLATE: u8 = 1;

/// Bump when a GraphQL schema change makes existing normalized records unsafe.
///
/// Additive fields do not require a bump: fragment reads only project selected
/// fields, so older records remain usable until a newly selected field is
/// fetched. Bump this epoch for incompatible changes to normalized identity,
/// field storage shape, or other schema-derived cache semantics.
// File-type facts now preserve raw server text instead of enum-normalizing it.
// Calendar range tables index cached occurrences, so older caches lack rows.
pub const CACHE_SCHEMA_COMPATIBILITY_EPOCH: u32 = 4;

#[derive(Debug, Error)]
pub enum CodecError {
    #[error("corrupt cache payload: {0}")]
    Corrupt(#[from] postcard::Error),
    #[error("corrupt compressed cache payload: {0}")]
    Inflate(String),
    #[error("unknown record encoding: {0}")]
    UnknownEncoding(u8),
}

fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    // Serialization of an in-memory cache value cannot fail.
    postcard::to_allocvec(value).expect("cache value serializes")
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, CodecError> {
    Ok(postcard::from_bytes(bytes)?)
}

/// Encodes a normalized record, deflating it when that makes the payload smaller.
pub fn encode_record(record: &Record) -> Vec<u8> {
    let raw = encode(record);
    let compressed = (raw.len() >= RECORD_COMPRESSION_MIN_BYTES)
        .then(|| deflate::compress_to_vec(&raw, RECORD_DEFLATE_LEVEL));
    match compressed {
        Some(compressed) if compressed.len() < raw.len() => {
            tagged(RECORD_ENCODING_DEFLATE, compressed)
        }
        _ => tagged(RECORD_ENCODING_RAW, raw),
    }
}

/// Decodes a normalized record written by [`encode_record`].
pub fn decode_record(bytes: &[u8]) -> Result<Record, CodecError> {
    let (encoding, payload) = bytes.split_first().ok_or(CodecError::UnknownEncoding(0))?;
    match *encoding {
        RECORD_ENCODING_RAW => decode(payload),
        RECORD_ENCODING_DEFLATE => {
            let raw = inflate::decompress_to_vec_with_limit(payload, RECORD_MAX_INFLATED_BYTES)
                .map_err(|error| CodecError::Inflate(format!("{error:?}")))?;
            decode(&raw)
        }
        other => Err(CodecError::UnknownEncoding(other)),
    }
}

fn tagged(encoding: u8, payload: Vec<u8>) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(payload.len() + 1);
    bytes.push(encoding);
    bytes.extend_from_slice(&payload);
    bytes
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
    cache_namespace_at(scope, CACHE_FORMAT_VERSION)
}

/// Cache format versions whose physical databases this build carries forward.
///
/// Opening one of these drops the derived records (they are refetched) while
/// keeping queued mutations and optimistic layers, then rewrites the namespace.
/// A format that is neither current nor listed here is reset instead.
pub const MIGRATABLE_CACHE_FORMAT_VERSIONS: &[u32] = &[3];

/// Namespace a cache scope used at one cache format version.
pub fn cache_namespace_at(scope: &str, format_version: u32) -> String {
    format!("graphql-cache:{scope}:s{CACHE_SCHEMA_COMPATIBILITY_EPOCH}:v{format_version}")
}

/// Storage versions `(schema compatibility epoch, cache format, storage
/// schema)` in use when database names began to embed versions. A build at
/// exactly these versions keeps the unversioned name, so that change moved no
/// database: the next build opens the same file, queued mutations included.
pub const UNVERSIONED_STORAGE_VERSIONS: (u32, u32, u32) = (3, 3, 11);

/// Physical database name for a cache scope at one storage version.
///
/// After [`UNVERSIONED_STORAGE_VERSIONS`], it embeds the schema compatibility
/// epoch, the cache format version, and the backend's
/// `storage_schema_version`, so builds that cannot share records use separate
/// files and owner locks instead of resetting each other's database while tabs
/// of both stay open after a deploy. Builds with matching versions share one
/// database: only a healthy, graceful close and reopen preserves its files.
/// Metadata is still validated on open, and a mismatch or an abrupt/uncertain
/// owner loss physically resets both files, discarding every row, including
/// queued mutations and optimistic layers.
pub fn cache_database_name(scope: &str, storage_schema_version: u32) -> String {
    let unversioned = legacy_cache_database_name(scope);
    if (
        CACHE_SCHEMA_COMPATIBILITY_EPOCH,
        CACHE_FORMAT_VERSION,
        storage_schema_version,
    ) == UNVERSIONED_STORAGE_VERSIONS
    {
        return unversioned;
    }
    format!(
        "{unversioned}:s{CACHE_SCHEMA_COMPATIBILITY_EPOCH}.v{CACHE_FORMAT_VERSION}.t{storage_schema_version}"
    )
}

/// Physical name every storage version shared before names embedded versions,
/// and still the name at [`UNVERSIONED_STORAGE_VERSIONS`].
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
        assert!(decode_record(&[]).is_err());
        assert!(decode_record(&[RECORD_ENCODING_DEFLATE, 0x13, 0x37]).is_err());
    }

    #[test]
    fn small_records_stay_raw() {
        let record = record_with_body("short body");
        let bytes = encode_record(&record);
        assert_eq!(bytes.first(), Some(&RECORD_ENCODING_RAW));
        assert_eq!(decode_record(&bytes).unwrap(), record);
    }

    #[test]
    fn large_text_records_deflate_and_round_trip() {
        let body = "review comment line\n".repeat(2_000);
        let record = record_with_body(&body);
        let bytes = encode_record(&record);
        assert_eq!(bytes.first(), Some(&RECORD_ENCODING_DEFLATE));
        assert!(
            bytes.len() < body.len() / 4,
            "compressed {} bytes",
            bytes.len()
        );
        assert_eq!(decode_record(&bytes).unwrap(), record);
    }

    fn record_with_body(body: &str) -> Record {
        let mut record = Record::default();
        record.fields.insert(
            "__typename".into(),
            CacheValue::String("GraphqlSoupForeignEntity".into()),
        );
        record
            .fields
            .insert("sourceMetadata".into(), CacheValue::String(body.into()));
        record
    }

    #[test]
    fn namespace_uses_schema_compatibility_epoch_not_schema_hash() {
        assert_eq!(
            cache_namespace("client-token-1"),
            "graphql-cache:client-token-1:s4:v4"
        );
    }

    #[test]
    fn migratable_versions_name_their_own_namespace() {
        assert_eq!(
            cache_namespace_at("client-token-1", 3),
            "graphql-cache:client-token-1:s4:v3"
        );
        assert!(!MIGRATABLE_CACHE_FORMAT_VERSIONS.contains(&CACHE_FORMAT_VERSION));
    }

    #[test]
    fn database_name_separates_storage_versions() {
        // The versions of the last unversioned builds kept their file; every
        // later epoch embeds its versions, even at that storage schema.
        assert_eq!(
            cache_database_name("client-token-1", 11),
            "graphql-cache:client-token-1:s4.v4.t11"
        );
        assert_eq!(
            cache_database_name("client-token-1", 12),
            "graphql-cache:client-token-1:s4.v4.t12"
        );
        assert_eq!(
            legacy_cache_database_name("client-token-1"),
            "graphql-cache:client-token-1"
        );
    }
}
