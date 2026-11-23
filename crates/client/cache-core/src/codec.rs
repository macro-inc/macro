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
//! Native files keep one path, so there an older storage version with
//! registered upgrade steps is upgraded in place instead (`cache-turso`'s
//! `storage/migration.rs`), and a format in
//! [`MIGRATABLE_CACHE_FORMAT_VERSIONS`] is carried forward.

use crate::normalize::RecordUpdates;
use crate::queue::{PersistedOptimisticLayer, StoredMutation};
use crate::value::Record;
use serde::{Serialize, de::DeserializeOwned};
use std::cell::RefCell;
use thiserror::Error;

/// Bump when the stored representation of [`Record`]/[`CacheValue`]
/// (or anything else persisted) changes incompatibly.
pub const CACHE_FORMAT_VERSION: u32 = 4;

/// Records at or above this size may be stored deflated; smaller ones stay raw.
///
/// Below 512 bytes deflate saves 19-30% of a few hundred bytes, under 150 bytes
/// a record, for about 10 times the CPU of storing it raw: on real records,
/// 11-14 us to encode instead of about 1, and 3.5-4.5 us to decode instead of
/// about 1. Past 512 bytes the savings grow with the record (74% above 4 KiB).
/// Records already stored deflated stay readable.
const RECORD_COMPRESSION_MIN_BYTES: usize = 512;

/// zlib-rs deflate level for record payloads.
///
/// Deflate runs while the cache engine lock is held. On real records of 512
/// bytes and up, level 2 takes 35 us a record in Chromium wasm (18 us native)
/// and stores 2% more bytes than level 3, which takes 44 us (20 us native);
/// level 1 takes 16 us but stores 24-27% more. Builds before zlib-rs used
/// miniz_oxide at level 3: 53 us in wasm (23 us native) for level 3's size.
const RECORD_DEFLATE_LEVEL: i32 = 2;

/// Upper bound for one inflated record. Real records are a few hundred KiB at
/// most; the bound turns a corrupt length prefix into a codec error.
const RECORD_MAX_INFLATED_BYTES: usize = 64 * 1024 * 1024;

const RECORD_ENCODING_RAW: u8 = 0;
const RECORD_ENCODING_DEFLATE: u8 = 1;

pub use cache_schema::CACHE_SCHEMA_COMPATIBILITY_EPOCH;

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
    if may_deflate(raw.len())
        && let Some(compressed) = deflate_smaller(&raw)
    {
        return compressed;
    }
    tagged(RECORD_ENCODING_RAW, &raw)
}

/// The deflate state and output space a thread reuses for every record.
struct Deflater {
    /// Reset per record. A fresh stream allocates and zeroes its window and
    /// hash tables, which costs about as much as deflating a typical record.
    stream: zlib_rs::Deflate,
    output: Vec<u8>,
}

thread_local! {
    static DEFLATER: RefCell<Deflater> = RefCell::new(Deflater {
        stream: zlib_rs::Deflate::new(RECORD_DEFLATE_LEVEL, false, 15),
        output: Vec::new(),
    });
}

/// `raw` deflated and tagged, when that is smaller than `raw`.
fn deflate_smaller(raw: &[u8]) -> Option<Vec<u8>> {
    // A thread's deflater is gone once its locals are being destroyed; a record
    // encoded from a destructor then gets a fresh one.
    DEFLATER
        .try_with(|cell| deflate_with(&mut cell.borrow_mut(), raw))
        .unwrap_or_else(|_| {
            let mut deflater = Deflater {
                stream: zlib_rs::Deflate::new(RECORD_DEFLATE_LEVEL, false, 15),
                output: Vec::new(),
            };
            deflate_with(&mut deflater, raw)
        })
}

fn deflate_with(deflater: &mut Deflater, raw: &[u8]) -> Option<Vec<u8>> {
    let Deflater { stream, output } = deflater;
    // Room for all of `raw`: a stream that fills it isn't smaller. One byte
    // less would turn away a stream that saves exactly one, because zlib-rs
    // reports a stream whose last byte fills the room as unfinished.
    let room = raw.len();
    if output.len() < room {
        output.resize(room, 0);
    }
    stream.reset();
    let status = stream.compress(raw, &mut output[..room], zlib_rs::DeflateFlush::Finish);
    let length = usize::try_from(stream.total_out()).unwrap_or(usize::MAX);
    let compressed = match status {
        Ok(zlib_rs::Status::StreamEnd) if length < room => {
            Some(tagged(RECORD_ENCODING_DEFLATE, &output[..length]))
        }
        _ => None,
    };
    if output.capacity() > RETAINED_OUTPUT_BYTES {
        *output = Vec::new();
    }
    compressed
}

/// Whether a record of `len` encoded bytes may be stored deflated: the reader
/// inflates up to the bound and no further, so a larger record stays raw and
/// reads back instead of failing as corrupt.
fn may_deflate(len: usize) -> bool {
    (RECORD_COMPRESSION_MIN_BYTES..=RECORD_MAX_INFLATED_BYTES).contains(&len)
}

/// Decodes a normalized record written by [`encode_record`].
pub fn decode_record(bytes: &[u8]) -> Result<Record, CodecError> {
    let (encoding, payload) = bytes.split_first().ok_or(CodecError::UnknownEncoding(0))?;
    match *encoding {
        RECORD_ENCODING_RAW => decode(payload),
        RECORD_ENCODING_DEFLATE => inflate_record(payload, decode),
        other => Err(CodecError::UnknownEncoding(other)),
    }
}

/// Output space a thread's first inflate starts with.
const INFLATE_INITIAL_BYTES: usize = 64 * 1024;

/// A thread keeps its deflate and inflate output between records up to this
/// size, so one unusually large record doesn't hold its memory for the thread's lifetime.
const RETAINED_OUTPUT_BYTES: usize = 1024 * 1024;

/// The inflate state and output space a thread reuses for every record.
struct Inflater {
    /// Reset per record. A fresh stream allocates and zeroes its window and
    /// decoding tables, which costs more than inflating a typical record.
    stream: zlib_rs::Inflate,
    /// Most records inflate to a few hundred bytes, where growing a fresh
    /// vector costs more than the inflate itself.
    output: Vec<u8>,
}

thread_local! {
    static INFLATER: RefCell<Inflater> = RefCell::new(Inflater {
        stream: zlib_rs::Inflate::new(false, 15),
        output: Vec::new(),
    });
}

/// Inflates a raw deflate `payload` and hands the bytes to `decode`.
fn inflate_record<T>(
    payload: &[u8],
    decode: impl FnOnce(&[u8]) -> Result<T, CodecError>,
) -> Result<T, CodecError> {
    INFLATER.with(|cell| {
        let Inflater { stream, output } = &mut *cell.borrow_mut();
        if output.len() < INFLATE_INITIAL_BYTES {
            output.resize(INFLATE_INITIAL_BYTES, 0);
        }
        let result = loop {
            stream.reset(false);
            let status = stream.decompress(payload, output, zlib_rs::InflateFlush::Finish);
            let length = usize::try_from(stream.total_out()).unwrap_or(usize::MAX);
            match status {
                Ok(zlib_rs::Status::StreamEnd) => break decode(&output[..length]),
                // The stream stopped before its end with the output full: inflate
                // again into twice the room.
                Ok(_) if length == output.len() && output.len() < RECORD_MAX_INFLATED_BYTES => {
                    let length = (output.len() * 2).min(RECORD_MAX_INFLATED_BYTES);
                    output.resize(length, 0);
                }
                Ok(_) if length == output.len() => {
                    break Err(CodecError::Inflate("BufError".to_owned()));
                }
                // The input ended before the stream did.
                Ok(_) | Err(zlib_rs::InflateError::NeedDict { .. }) => {
                    break Err(CodecError::Inflate("DataError".to_owned()));
                }
                Err(error) => break Err(CodecError::Inflate(format!("{error:?}"))),
            }
        };
        if output.capacity() > RETAINED_OUTPUT_BYTES {
            *output = Vec::new();
        }
        result
    })
}

fn tagged(encoding: u8, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(payload.len() + 1);
    bytes.push(encoding);
    bytes.extend_from_slice(payload);
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
        for body in ["short body".to_owned(), "review comment line\n".repeat(20)] {
            let record = record_with_body(&body);
            let bytes = encode_record(&record);
            assert!(bytes.len() < RECORD_COMPRESSION_MIN_BYTES);
            assert_eq!(bytes.first(), Some(&RECORD_ENCODING_RAW));
            assert_eq!(decode_record(&bytes).unwrap(), record);
            // Written deflated by builds with a lower threshold.
            let stored = miniz_deflated(&record);
            assert_eq!(decode_record(&stored).unwrap(), record);
        }
    }

    #[test]
    fn records_past_the_inflate_bound_stay_raw_and_read_back() {
        let record = record_with_body(&"x".repeat(RECORD_MAX_INFLATED_BYTES));
        let bytes = encode_record(&record);
        assert_eq!(bytes.first(), Some(&RECORD_ENCODING_RAW));
        assert_eq!(decode_record(&bytes).unwrap(), record);

        // A record of exactly the bound still deflates: the reader inflates it.
        let overhead = encode(&record).len() - RECORD_MAX_INFLATED_BYTES;
        let record = record_with_body(&"x".repeat(RECORD_MAX_INFLATED_BYTES - overhead));
        assert_eq!(encode(&record).len(), RECORD_MAX_INFLATED_BYTES);
        let bytes = encode_record(&record);
        assert_eq!(bytes.first(), Some(&RECORD_ENCODING_DEFLATE));
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
        // Written by builds that deflated with miniz_oxide.
        assert_eq!(decode_record(&miniz_deflated(&record)).unwrap(), record);
    }

    #[test]
    fn inflate_grows_past_its_first_buffer_and_rejects_truncated_streams() {
        let body: String = (0..40_000).map(|line| format!("{line}\n")).collect();
        let record = record_with_body(&body);
        let bytes = encode_record(&record);
        assert_eq!(bytes.first(), Some(&RECORD_ENCODING_DEFLATE));
        assert!(body.len() > INFLATE_INITIAL_BYTES * 3);
        assert_eq!(decode_record(&bytes).unwrap(), record);
        // The reused state starts clean for the next record.
        let small = record_with_body(&"x".repeat(1_000));
        assert_eq!(decode_record(&encode_record(&small)).unwrap(), small);
        assert!(decode_record(&bytes[..bytes.len() / 2]).is_err());
        assert_eq!(decode_record(&bytes).unwrap(), record);
    }

    #[test]
    fn bytes_that_deflate_no_smaller_stay_raw() {
        let mut state = 0x2545_f491_4f6c_dd1d_u64;
        let noise: Vec<u8> = (0..4096)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                state.to_le_bytes()[0]
            })
            .collect();
        assert_eq!(deflate_smaller(&noise), None);
        let text = "review comment line\n".repeat(200);
        let deflated = deflate_smaller(text.as_bytes()).unwrap();
        assert!(deflated.len() < text.len());
        let mut inflated = Vec::new();
        inflate_record(&deflated[1..], |bytes| {
            inflated = bytes.to_vec();
            Ok(())
        })
        .unwrap();
        assert_eq!(inflated, text.as_bytes());
    }

    #[test]
    fn deflated_whenever_the_stream_is_smaller_even_by_one_byte() {
        // Mostly two-byte UTF-8 characters, which deflate to about their own size.
        let mut state = 1_u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let mut saved_one = 0;
        for _ in 0..400 {
            let mut body = String::new();
            while body.len() < 556 {
                let choice = next() as u8;
                let bits = (next() >> 8) as u32;
                let code = if u32::from(choice) * 100 / 256 < 75 {
                    128 + bits % 1920
                } else {
                    bits % 128
                };
                body.push(char::from_u32(code).unwrap());
            }
            let raw = encode(&record_with_body(&body));
            let mut whole = Deflater {
                stream: zlib_rs::Deflate::new(RECORD_DEFLATE_LEVEL, false, 15),
                output: vec![0; raw.len() * 2],
            };
            let status =
                whole
                    .stream
                    .compress(&raw, &mut whole.output, zlib_rs::DeflateFlush::Finish);
            assert_eq!(status, Ok(zlib_rs::Status::StreamEnd));
            let length = usize::try_from(whole.stream.total_out()).unwrap();
            let expected = (length < raw.len())
                .then(|| tagged(RECORD_ENCODING_DEFLATE, &whole.output[..length]));
            saved_one += usize::from(length + 1 == raw.len());
            assert_eq!(deflate_smaller(&raw), expected);
        }
        assert!(saved_one > 0, "no input saved exactly one byte");
    }

    #[test]
    fn records_encoded_while_thread_locals_are_destroyed_still_deflate() {
        struct EncodeOnDrop;
        impl Drop for EncodeOnDrop {
            fn drop(&mut self) {
                let record = record_with_body(&"x".repeat(4_096));
                let bytes = encode_record(&record);
                assert_eq!(bytes.first(), Some(&RECORD_ENCODING_DEFLATE));
                assert_eq!(decode_record(&bytes).unwrap(), record);
            }
        }
        thread_local! {
            static ENCODE_ON_DROP: RefCell<Option<EncodeOnDrop>> = const { RefCell::new(None) };
        }
        std::thread::spawn(|| {
            ENCODE_ON_DROP.with(|cell| *cell.borrow_mut() = Some(EncodeOnDrop));
            // Starts the deflater after the drop guard, so it is destroyed first.
            encode_record(&record_with_body(&"x".repeat(4_096)));
        })
        .join()
        .unwrap();
    }

    #[test]
    fn records_written_now_decode_in_builds_before_zlib_rs() {
        let mut bodies = vec![
            "x".repeat(300),
            "review comment line\n".repeat(2_000),
            (0..40_000).map(|line| format!("{line}\n")).collect(),
        ];
        let mut state = 7_u64;
        for length in (300..4_000).step_by(37) {
            let body = (0..length)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    char::from_u32(32 + (state % 2_000) as u32).unwrap_or('?')
                })
                .collect();
            bodies.push(body);
        }
        let (mut raw, mut deflated) = (0, 0);
        for body in bodies {
            let record = record_with_body(&body);
            let bytes = encode_record(&record);
            // The decoder of builds before zlib-rs: raw at any length, or a raw
            // DEFLATE stream inflated by miniz_oxide under the same bound.
            let (encoding, payload) = bytes.split_first().unwrap();
            let decoded: Record = match *encoding {
                RECORD_ENCODING_RAW => {
                    raw += 1;
                    decode(payload).unwrap()
                }
                RECORD_ENCODING_DEFLATE => {
                    deflated += 1;
                    let inflated = miniz_oxide::inflate::decompress_to_vec_with_limit(
                        payload,
                        RECORD_MAX_INFLATED_BYTES,
                    )
                    .unwrap();
                    decode(&inflated).unwrap()
                }
                other => panic!("unknown encoding {other}"),
            };
            assert_eq!(decoded, record);
        }
        assert!(raw > 0 && deflated > 0, "raw {raw}, deflated {deflated}");
    }

    /// A record as builds before zlib-rs stored it: miniz_oxide at level 3.
    fn miniz_deflated(record: &Record) -> Vec<u8> {
        let compressed = miniz_oxide::deflate::compress_to_vec(&encode(record), 3);
        tagged(RECORD_ENCODING_DEFLATE, &compressed)
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
