//! Bounded physical records for one logical durable operation.
use sha2::{Digest, Sha256};

/// Encoded SQLite row ceiling measured on both pinned workerd runtimes.
/// A single BLOB with a five-byte SQLite record header accepts 2,199,995 bytes
/// and rejects 2,199,996. Keep physical values well below this encoded-row limit.
pub const SQLITE_ROW_LIMIT_BYTES: usize = 2_200_000;
/// Conservative documented production ceiling; local runtime capacity is not deployment authority.
pub const DOCUMENTED_ROW_LIMIT_BYTES: usize = 2_000_000;
/// Physical format budget is bounded by both documented and measured limits.
pub const ROW_BUDGET_BYTES: usize = if SQLITE_ROW_LIMIT_BYTES < DOCUMENTED_ROW_LIMIT_BYTES {
    SQLITE_ROW_LIMIT_BYTES
} else {
    DOCUMENTED_ROW_LIMIT_BYTES
};
/// Persistent activation metadata, discovered by the existing pending-prefix read.
pub const FORMAT_MARKER_KEY: &str = "o/!operation-chunks-v1";
/// Versioned metadata is not a logical operation and must never be replayed as Loro.
pub const FORMAT_MARKER_VALUE: &[u8] = b"SYNC_OPERATION_CHUNKS_V1";
/// Retain legacy inline/archive bytes; activated pending rows may embed receipts.
pub const INLINE_BYTES: usize = 512 * 1024;
/// Maximum raw bytes in a physical operation chunk.
pub const CHUNK_BYTES: usize = 256 * 1024;
// Byte buffers leave over 85% of the conservative SQLite budget for encoding/key
// overhead. Inline legacy number arrays need more space than their raw bytes.
const _: () = assert!(CHUNK_BYTES < ROW_BUDGET_BYTES / 4);
const _: () = assert!(INLINE_BYTES * 3 < ROW_BUDGET_BYTES);
/// Physical keys are outside the legacy pending/archive prefixes.
pub const CHUNK_PREFIX: &str = "operation-chunks/";
const MAGIC: &[u8] = b"SYNC_OP_CHUNKS\x01";
const COMPLETE_MAGIC: &[u8] = b"SYNC_OP_CHUNKS\x02";
const HEADER_BYTES: usize = MAGIC.len() + 16 + 32;

/// Chunk geometry, checksum and optional atomic archive-completion receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    length: usize,
    count: usize,
    digest: [u8; 32],
    archive_complete: bool,
}
/// An incomplete or corrupt physical operation is never replayed as a prefix.
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum ChunkError {
    /// The version, size or geometry is invalid.
    #[error("invalid operation chunk manifest")]
    Manifest,
    /// A required chunk is absent, extra, or has the wrong size.
    #[error("incomplete operation chunks")]
    Incomplete,
    /// The assembled bytes do not match the committed digest.
    #[error("operation chunk checksum mismatch")]
    Checksum,
}
impl Manifest {
    /// Return a manifest only for operations requiring physical chunking.
    #[cfg(test)]
    pub fn for_update(update: &[u8]) -> Option<Self> {
        (update.len() > INLINE_BYTES).then(|| Self {
            length: update.len(),
            count: update.len().div_ceil(CHUNK_BYTES),
            digest: Sha256::digest(update).into(),
            archive_complete: false,
        })
    }
    /// Record that pending and archive committed in the same atomic append.
    #[cfg(test)]
    pub fn with_archive_complete(mut self) -> Self {
        self.archive_complete = true;
        self
    }
    /// Whether the pending row contains an atomic archive-completion receipt.
    #[cfg(test)]
    pub fn archive_complete(&self) -> bool {
        self.archive_complete
    }
    /// Number of chunks belonging to this logical operation.
    pub fn count(&self) -> usize {
        self.count
    }
    /// Distinguish the versioned manifest from legacy Loro operation bytes.
    pub fn decode(bytes: &[u8]) -> Result<Option<Self>, ChunkError> {
        let archive_complete = bytes.starts_with(COMPLETE_MAGIC);
        if !bytes.starts_with(MAGIC) && !archive_complete {
            if bytes.starts_with(&MAGIC[..MAGIC.len() - 1]) {
                return Err(ChunkError::Manifest);
            }
            return Ok(None);
        }
        if bytes.len() != HEADER_BYTES {
            return Err(ChunkError::Manifest);
        }
        let mut length = [0; 8];
        length.copy_from_slice(&bytes[MAGIC.len()..MAGIC.len() + 8]);
        let mut count = [0; 8];
        count.copy_from_slice(&bytes[MAGIC.len() + 8..MAGIC.len() + 16]);
        let length =
            usize::try_from(u64::from_le_bytes(length)).map_err(|_| ChunkError::Manifest)?;
        let count = usize::try_from(u64::from_le_bytes(count)).map_err(|_| ChunkError::Manifest)?;
        if length <= INLINE_BYTES || count != length.div_ceil(CHUNK_BYTES) {
            return Err(ChunkError::Manifest);
        }
        let mut digest = [0; 32];
        digest.copy_from_slice(&bytes[MAGIC.len() + 16..]);
        Ok(Some(Self {
            length,
            count,
            digest,
            archive_complete,
        }))
    }
    /// Persisted marker; raw Loro values have a different magic prefix.
    #[cfg(test)]
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HEADER_BYTES);
        bytes.extend_from_slice(if self.archive_complete {
            COMPLETE_MAGIC
        } else {
            MAGIC
        });
        bytes.extend_from_slice(&(self.length as u64).to_le_bytes());
        bytes.extend_from_slice(&(self.count as u64).to_le_bytes());
        bytes.extend_from_slice(&self.digest);
        bytes
    }
    /// Validate every chunk and the complete bytes before exposing an operation.
    pub fn assemble(&self, chunks: &[Vec<u8>]) -> Result<Vec<u8>, ChunkError> {
        if chunks.len() != self.count {
            return Err(ChunkError::Incomplete);
        }
        let mut bytes = Vec::new();
        for (index, chunk) in chunks.iter().enumerate() {
            let expected = if index + 1 == self.count {
                self.length - CHUNK_BYTES * (self.count - 1)
            } else {
                CHUNK_BYTES
            };
            if chunk.len() != expected {
                return Err(ChunkError::Incomplete);
            }
            bytes.extend_from_slice(chunk);
        }
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        if digest != self.digest {
            return Err(ChunkError::Checksum);
        }
        Ok(bytes)
    }
}
/// Four-byte receipt tag, outside the byte range of legacy Loro number arrays.
pub const INLINE_COMPLETE_TAG: u32 = 0x5343_0001;

/// Stream a receipt tag and typed byte buffer without concatenating the payload.
#[cfg(test)]
pub struct CompleteInline<'a>(pub &'a [u8]);
#[cfg(test)]
impl serde::Serialize for CompleteInline<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeTuple;
        let mut tuple = serializer.serialize_tuple(2)?;
        tuple.serialize_element(&INLINE_COMPLETE_TAG)?;
        tuple.serialize_element(&ChunkBytes(self.0))?;
        tuple.end()
    }
}

/// Serialize physical buffers as bytes rather than one JavaScript number per byte.
#[cfg(test)]
pub struct ChunkBytes<'a>(pub &'a [u8]);
#[cfg(test)]
impl serde::Serialize for ChunkBytes<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bytes(self.0)
    }
}

/// Stable physical key scoped to the complete legacy logical key.
pub fn chunk_key(logical: &str, index: usize) -> String {
    format!("{CHUNK_PREFIX}{logical}/{index:08x}")
}

#[cfg(test)]
mod test;
