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
/// Keep existing small operation values byte-for-byte unchanged.
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
const HEADER_BYTES: usize = MAGIC.len() + 16 + 32;

/// Complete-operation metadata committed atomically with its chunks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    length: usize,
    count: usize,
    digest: [u8; 32],
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
    pub fn for_update(update: &[u8]) -> Option<Self> {
        (update.len() > INLINE_BYTES).then(|| Self {
            length: update.len(),
            count: update.len().div_ceil(CHUNK_BYTES),
            digest: Sha256::digest(update).into(),
        })
    }
    /// Number of chunks belonging to this logical operation.
    pub fn count(&self) -> usize {
        self.count
    }
    /// Distinguish the versioned manifest from legacy Loro operation bytes.
    pub fn decode(bytes: &[u8]) -> Result<Option<Self>, ChunkError> {
        if !bytes.starts_with(MAGIC) {
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
        }))
    }
    /// Persisted marker; raw Loro values have a different magic prefix.
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HEADER_BYTES);
        bytes.extend_from_slice(MAGIC);
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
/// Stable physical key scoped to the complete legacy logical key.
pub fn chunk_key(logical: &str, index: usize) -> String {
    format!("{CHUNK_PREFIX}{logical}/{index:08x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_operations_reject_missing_reordered_and_corrupt_chunks() {
        let data: Vec<u8> = (0..INLINE_BYTES + 31)
            .map(|i| (i.wrapping_mul(17) % 251) as u8)
            .collect();
        assert_eq!(
            chunk_key("o/record", 1),
            "operation-chunks/o/record/00000001"
        );
        let manifest = Manifest::for_update(&data).unwrap();
        assert_eq!(
            Manifest::decode(&manifest.encode()).unwrap(),
            Some(manifest.clone())
        );
        let mut chunks: Vec<_> = data.chunks(CHUNK_BYTES).map(<[u8]>::to_vec).collect();
        assert_eq!(manifest.assemble(&chunks).unwrap(), data);
        assert_eq!(manifest.assemble(&chunks[..2]), Err(ChunkError::Incomplete));
        chunks.swap(0, 1);
        assert_eq!(manifest.assemble(&chunks), Err(ChunkError::Checksum));
        chunks.swap(0, 1);
        chunks[0][1] ^= 1;
        assert_eq!(manifest.assemble(&chunks), Err(ChunkError::Checksum));
        assert!(Manifest::for_update(&vec![0; INLINE_BYTES]).is_none());
        assert_eq!(Manifest::decode(b"loro legacy bytes").unwrap(), None);
        assert_eq!(Manifest::decode(MAGIC), Err(ChunkError::Manifest));
    }
}
