use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use item_filter_index::vocabulary;
use predicate_index::{Profile, RecordKey, Token, ValidationError};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Framing byte for the first immutable Soup server-fact supplement layout.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION: u8 = 0x01;
/// Maximum decoded bytes accepted for one entity supplement, including framing.
pub const MAX_SOUP_CACHE_PROJECTION_BYTES: usize = 1_024;
/// Maximum RFC 4648 unpadded base64 bytes accepted before decoding.
pub const MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES: usize =
    (MAX_SOUP_CACHE_PROJECTION_BYTES * 4).div_ceil(3);

/// Typed server-only facts supplement for one Soup document projection.
///
/// The browser must bind this value to the surrounding normalized record,
/// derive direct facts from that same GraphQL response, merge this supplement,
/// and validate the resulting complete target-profile document. This type is
/// intentionally not convertible into an [`predicate_index::IndexDocument`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupCacheProjectionSupplement {
    record_key: RecordKey,
    target_profile: Profile,
    partition: Token,
    is_email_attachment: bool,
}

impl SoupCacheProjectionSupplement {
    /// Construct the supplement for authoritative document relation state.
    pub fn document(record_key: RecordKey, is_email_attachment: bool) -> Self {
        Self {
            record_key,
            target_profile: vocabulary::profile_v2(),
            partition: vocabulary::document_partition(),
            is_email_attachment,
        }
    }

    /// Read the normalized record binding.
    pub fn record_key(&self) -> &RecordKey {
        &self.record_key
    }

    /// Read the complete projection profile this supplement targets.
    pub fn target_profile(&self) -> &Profile {
        &self.target_profile
    }

    /// Read the entity partition binding.
    pub fn partition(&self) -> &Token {
        &self.partition
    }

    /// Read the authoritative email-attachment relation fact.
    pub fn is_email_attachment(&self) -> bool {
        self.is_email_attachment
    }
}

/// Immutable postcard payload for one server-fact supplement.
///
/// Field order is wire-significant and locked by cross-adapter golden fixtures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoupCacheProjectionCapsuleV1 {
    /// Complete projection profile to which these server facts may be applied.
    pub target_profile: String,
    /// Defensive normalized-record binding.
    pub record_key: String,
    /// Defensive entity-partition binding.
    pub partition: String,
    /// Explicit authoritative `document_email` membership state.
    pub is_email_attachment: bool,
}

/// Failure to encode or decode a bounded Soup server-fact supplement.
#[derive(Debug, Error)]
pub enum SoupCacheProjectionWireError {
    /// The untrusted encoded scalar exceeds the pre-decode bound.
    #[error("Soup cache-projection scalar is too large")]
    EncodedTooLarge,
    /// The decoded framing and postcard payload exceed the supplement bound.
    #[error("Soup cache-projection supplement is too large")]
    DecodedTooLarge,
    /// The scalar is not canonical RFC 4648 standard unpadded base64.
    #[error("invalid Soup cache-projection base64")]
    InvalidBase64(#[source] base64::DecodeError),
    /// The framing byte is absent.
    #[error("Soup cache-projection supplement is empty")]
    Empty,
    /// The framing byte is not understood by this decoder.
    #[error("unsupported Soup cache-projection wire version {0}")]
    UnsupportedWireVersion(u8),
    /// The postcard payload is malformed.
    #[error("invalid Soup cache-projection postcard payload")]
    InvalidPostcard(#[source] postcard::Error),
    /// Bytes remain after decoding the immutable v1 postcard value.
    #[error("Soup cache-projection supplement contains trailing bytes")]
    TrailingBytes,
    /// A storage-neutral token or key bound is invalid.
    #[error(transparent)]
    GenericValidation(#[from] ValidationError),
    /// The supplement targets a projection profile not understood by this wire contract.
    #[error("unsupported Soup cache-projection target profile `{0}`")]
    UnsupportedTargetProfile(String),
    /// The supplement declares a partition that has no server-only v1 facts.
    #[error("unsupported Soup cache-projection supplement partition `{0}`")]
    UnsupportedPartition(String),
    /// The defensive record key does not identify a document in the declared partition.
    #[error("Soup cache-projection record key does not match its document partition")]
    RecordKeyPartitionMismatch,
}

/// Encode one canonical document server-fact supplement as standard unpadded
/// base64 over a version byte and postcard capsule-v1 payload.
pub fn encode_cache_projection_supplement(
    supplement: &SoupCacheProjectionSupplement,
) -> Result<String, SoupCacheProjectionWireError> {
    validate_supplement(supplement)?;
    let capsule = SoupCacheProjectionCapsuleV1::from(supplement);
    let payload =
        postcard::to_stdvec(&capsule).map_err(SoupCacheProjectionWireError::InvalidPostcard)?;
    let decoded_len = payload.len().saturating_add(1);
    if decoded_len > MAX_SOUP_CACHE_PROJECTION_BYTES {
        return Err(SoupCacheProjectionWireError::DecodedTooLarge);
    }

    let mut framed = Vec::with_capacity(decoded_len);
    framed.push(SOUP_CACHE_PROJECTION_WIRE_VERSION);
    framed.extend(payload);
    Ok(STANDARD_NO_PAD.encode(framed))
}

/// Decode and strictly validate one single-entity Soup server-fact supplement.
pub fn decode_cache_projection_supplement(
    encoded: &str,
) -> Result<SoupCacheProjectionSupplement, SoupCacheProjectionWireError> {
    if encoded.len() > MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES {
        return Err(SoupCacheProjectionWireError::EncodedTooLarge);
    }
    let framed = STANDARD_NO_PAD
        .decode(encoded)
        .map_err(SoupCacheProjectionWireError::InvalidBase64)?;
    if framed.len() > MAX_SOUP_CACHE_PROJECTION_BYTES {
        return Err(SoupCacheProjectionWireError::DecodedTooLarge);
    }
    let (&version, payload) = framed
        .split_first()
        .ok_or(SoupCacheProjectionWireError::Empty)?;
    if version != SOUP_CACHE_PROJECTION_WIRE_VERSION {
        return Err(SoupCacheProjectionWireError::UnsupportedWireVersion(
            version,
        ));
    }

    let (capsule, trailing) = postcard::take_from_bytes::<SoupCacheProjectionCapsuleV1>(payload)
        .map_err(SoupCacheProjectionWireError::InvalidPostcard)?;
    if !trailing.is_empty() {
        return Err(SoupCacheProjectionWireError::TrailingBytes);
    }
    SoupCacheProjectionSupplement::try_from(capsule)
}

impl From<&SoupCacheProjectionSupplement> for SoupCacheProjectionCapsuleV1 {
    fn from(supplement: &SoupCacheProjectionSupplement) -> Self {
        Self {
            target_profile: supplement.target_profile.token().as_str().to_owned(),
            record_key: supplement.record_key.as_str().to_owned(),
            partition: supplement.partition.as_str().to_owned(),
            is_email_attachment: supplement.is_email_attachment,
        }
    }
}

impl TryFrom<SoupCacheProjectionCapsuleV1> for SoupCacheProjectionSupplement {
    type Error = SoupCacheProjectionWireError;

    fn try_from(capsule: SoupCacheProjectionCapsuleV1) -> Result<Self, Self::Error> {
        let supplement = Self {
            record_key: RecordKey::new(capsule.record_key)?,
            target_profile: Profile::new(Token::new(capsule.target_profile)?),
            partition: Token::new(capsule.partition)?,
            is_email_attachment: capsule.is_email_attachment,
        };
        validate_supplement(&supplement)?;
        Ok(supplement)
    }
}

fn validate_supplement(
    supplement: &SoupCacheProjectionSupplement,
) -> Result<(), SoupCacheProjectionWireError> {
    if supplement.target_profile != vocabulary::profile_v2() {
        return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
            supplement.target_profile.token().as_str().to_owned(),
        ));
    }
    if supplement.partition != vocabulary::document_partition() {
        return Err(SoupCacheProjectionWireError::UnsupportedPartition(
            supplement.partition.as_str().to_owned(),
        ));
    }
    if !supplement
        .record_key
        .as_str()
        .starts_with("GraphqlSoupDocument:")
    {
        return Err(SoupCacheProjectionWireError::RecordKeyPartitionMismatch);
    }
    Ok(())
}
