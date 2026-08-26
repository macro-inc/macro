use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IntegerFact, Profile, RecordKey, Token, ValidationError,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{ProfileValidationError, validate_soup_flat_v2};

/// Framing byte for the first immutable Soup cache-projection capsule layout.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION: u8 = 0x01;
/// Maximum decoded bytes accepted for one entity capsule, including framing.
pub const MAX_SOUP_CACHE_PROJECTION_BYTES: usize = 64 * 1024;
/// Maximum RFC 4648 unpadded base64 bytes accepted before decoding.
pub const MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES: usize =
    MAX_SOUP_CACHE_PROJECTION_BYTES.div_ceil(3) * 4;

/// One exact-match fact in the immutable capsule-v1 layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExactFactWire {
    /// Stable profile-owned attribute token.
    pub attribute: String,
    /// Canonical bounded exact value bytes.
    pub value: Vec<u8>,
}

/// One integer or sort fact in the immutable capsule-v1 layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntegerFactWire {
    /// Stable profile-owned attribute token.
    pub attribute: String,
    /// Signed canonical integer value.
    pub value: i64,
}

/// Immutable postcard payload for one server-minted entity projection.
///
/// Field order is wire-significant and locked by cross-adapter golden fixtures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoupCacheProjectionCapsuleV1 {
    /// Embedded projection profile completeness contract.
    pub profile: String,
    /// Defensive normalized-record binding.
    pub record_key: String,
    /// Defensive entity-partition binding.
    pub partition: String,
    /// Exact-match facts.
    pub exact_facts: Vec<ExactFactWire>,
    /// Integer membership/range facts.
    pub integer_facts: Vec<IntegerFactWire>,
    /// Integer sort facts.
    pub sort_facts: Vec<IntegerFactWire>,
}

/// Failure to encode or decode a bounded Soup cache-projection capsule.
#[derive(Debug, Error)]
pub enum SoupCacheProjectionWireError {
    /// The untrusted encoded scalar exceeds the pre-decode bound.
    #[error("Soup cache-projection scalar is too large")]
    EncodedTooLarge,
    /// The decoded framing and postcard payload exceed the capsule bound.
    #[error("Soup cache-projection capsule is too large")]
    DecodedTooLarge,
    /// The scalar is not canonical RFC 4648 standard unpadded base64.
    #[error("invalid Soup cache-projection base64")]
    InvalidBase64(#[source] base64::DecodeError),
    /// The framing byte is absent.
    #[error("Soup cache-projection capsule is empty")]
    Empty,
    /// The framing byte is not understood by this decoder.
    #[error("unsupported Soup cache-projection wire version {0}")]
    UnsupportedWireVersion(u8),
    /// The postcard payload is malformed.
    #[error("invalid Soup cache-projection postcard payload")]
    InvalidPostcard(#[source] postcard::Error),
    /// Bytes remain after decoding the immutable v1 postcard value.
    #[error("Soup cache-projection capsule contains trailing bytes")]
    TrailingBytes,
    /// A storage-neutral token, value, key, or fact bound is invalid.
    #[error(transparent)]
    GenericValidation(#[from] ValidationError),
    /// The decoded document violates `soup-flat-v2` semantics.
    #[error(transparent)]
    ProfileValidation(#[from] ProfileValidationError),
}

/// Encode one complete canonical `soup-flat-v2` document as standard unpadded
/// base64 over a version byte and postcard capsule-v1 payload.
pub fn encode_cache_projection(
    document: &IndexDocument,
) -> Result<String, SoupCacheProjectionWireError> {
    validate_soup_flat_v2(document)?;
    let mut canonical = document.clone();
    canonical.canonicalize();
    let capsule = SoupCacheProjectionCapsuleV1::from(&canonical);
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

/// Decode and strictly validate one single-entity Soup cache-projection scalar.
pub fn decode_cache_projection(
    encoded: &str,
) -> Result<IndexDocument, SoupCacheProjectionWireError> {
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
    let document = IndexDocument::try_from(capsule)?;
    validate_soup_flat_v2(&document)?;
    Ok(document)
}

impl From<&IndexDocument> for SoupCacheProjectionCapsuleV1 {
    fn from(document: &IndexDocument) -> Self {
        Self {
            profile: document.profile.token().as_str().to_owned(),
            record_key: document.record_key.as_str().to_owned(),
            partition: document.partition.as_str().to_owned(),
            exact_facts: document
                .exact_facts
                .iter()
                .map(|fact| ExactFactWire {
                    attribute: fact.attribute.as_str().to_owned(),
                    value: fact.value.as_bytes().to_vec(),
                })
                .collect(),
            integer_facts: document
                .integer_facts
                .iter()
                .map(IntegerFactWire::from)
                .collect(),
            sort_facts: document
                .sort_facts
                .iter()
                .map(IntegerFactWire::from)
                .collect(),
        }
    }
}

impl From<&IntegerFact> for IntegerFactWire {
    fn from(fact: &IntegerFact) -> Self {
        Self {
            attribute: fact.attribute.as_str().to_owned(),
            value: fact.value,
        }
    }
}

impl TryFrom<SoupCacheProjectionCapsuleV1> for IndexDocument {
    type Error = SoupCacheProjectionWireError;

    fn try_from(capsule: SoupCacheProjectionCapsuleV1) -> Result<Self, Self::Error> {
        let exact_facts = capsule
            .exact_facts
            .into_iter()
            .map(|fact| {
                Ok(ExactFact {
                    attribute: Token::new(fact.attribute)?,
                    value: ExactValue::new(fact.value)?,
                })
            })
            .collect::<Result<Vec<_>, SoupCacheProjectionWireError>>()?;
        let integer_membership_facts = integer_facts(capsule.integer_facts)?;
        let sort_facts = integer_facts(capsule.sort_facts)?;
        let document = IndexDocument {
            record_key: RecordKey::new(capsule.record_key)?,
            profile: Profile::new(Token::new(capsule.profile)?),
            partition: Token::new(capsule.partition)?,
            exact_facts,
            integer_facts: integer_membership_facts,
            sort_facts,
        };
        document.validate()?;
        Ok(document)
    }
}

fn integer_facts(
    facts: Vec<IntegerFactWire>,
) -> Result<Vec<IntegerFact>, SoupCacheProjectionWireError> {
    facts
        .into_iter()
        .map(|fact| {
            Ok(IntegerFact {
                attribute: Token::new(fact.attribute)?,
                value: fact.value,
            })
        })
        .collect()
}
