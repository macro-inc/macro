//! Binary record codec shared by all persistent backends (IndexedDB,
//! SQLite). Records are stored as postcard bytes; the cache namespace embeds
//! [`CACHE_FORMAT_VERSION`] and [`meta::SCHEMA_HASH`](crate::meta) so a
//! format or schema change starts a fresh cache instead of attempting
//! migration (the cache is disposable by design).

use crate::value::Record;
use thiserror::Error;

/// Bump when the stored representation of [`Record`]/[`CacheValue`]
/// (or anything else persisted) changes incompatibly.
pub const CACHE_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum CodecError {
    #[error("corrupt record: {0}")]
    Corrupt(#[from] postcard::Error),
}

pub fn encode_record(record: &Record) -> Vec<u8> {
    // Serialization of an in-memory record cannot fail.
    postcard::to_allocvec(record).expect("record serializes")
}

pub fn decode_record(bytes: &[u8]) -> Result<Record, CodecError> {
    Ok(postcard::from_bytes(bytes)?)
}

/// Canonical database/namespace name for a cache instance.
/// `scope` identifies the user/workspace (host-provided).
pub fn cache_namespace(scope: &str) -> String {
    format!(
        "graphql-cache:{scope}:{}:v{CACHE_FORMAT_VERSION}",
        &crate::meta::SCHEMA_HASH[..12]
    )
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
