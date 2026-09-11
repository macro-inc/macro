use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use item_filter_index::vocabulary;
use predicate_index::{Profile, RecordKey, Token, ValidationError};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Framing byte for the first immutable Soup server-fact supplement layout.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION_V1: u8 = 0x01;
/// Framing byte for the viewer-relative Soup server-fact supplement layout.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION_V2: u8 = 0x02;
/// Framing byte for the Mail server-fact supplement layout.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION_V3: u8 = 0x03;
/// Latest framing byte understood by this version of the server.
pub const SOUP_CACHE_PROJECTION_WIRE_VERSION: u8 = SOUP_CACHE_PROJECTION_WIRE_VERSION_V3;
/// Maximum decoded bytes accepted for one entity supplement, including framing.
pub const MAX_SOUP_CACHE_PROJECTION_BYTES: usize = 1_024;
/// Maximum RFC 4648 unpadded base64 bytes accepted before decoding.
pub const MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES: usize =
    (MAX_SOUP_CACHE_PROJECTION_BYTES * 4).div_ceil(3);

/// Server-only facts used by an offline Mail projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailCacheProjectionFacts {
    latest_non_spam_message_ts: Option<i64>,
    latest_outbound_message_ts: Option<i64>,
    has_calendar_attachment: bool,
    has_thread_share: bool,
}

impl MailCacheProjectionFacts {
    /// Construct canonical Mail filter and sort facts.
    pub fn new(
        latest_non_spam_message_ts: Option<i64>,
        latest_outbound_message_ts: Option<i64>,
        has_calendar_attachment: bool,
        has_thread_share: bool,
    ) -> Self {
        Self {
            latest_non_spam_message_ts,
            latest_outbound_message_ts,
            has_calendar_attachment,
            has_thread_share,
        }
    }

    /// Read the canonical ALL-view timestamp in microseconds.
    pub fn latest_non_spam_message_ts(&self) -> Option<i64> {
        self.latest_non_spam_message_ts
    }

    /// Read the canonical SENT-view timestamp in microseconds.
    pub fn latest_outbound_message_ts(&self) -> Option<i64> {
        self.latest_outbound_message_ts
    }

    /// Read the authoritative Calendar-tab classification.
    pub fn has_calendar_attachment(&self) -> bool {
        self.has_calendar_attachment
    }

    /// Read the viewer-relative direct-share fact.
    pub fn has_thread_share(&self) -> bool {
        self.has_thread_share
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SoupCacheProjectionFacts {
    Document {
        is_email_attachment: bool,
        is_important: Option<bool>,
        status_option_ids: Option<Vec<Uuid>>,
    },
    Mail(MailCacheProjectionFacts),
}

/// Typed server-only facts supplement for one Soup entity projection.
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
    facts: SoupCacheProjectionFacts,
}

impl SoupCacheProjectionSupplement {
    /// Construct a v2 supplement containing authoritative attachment state.
    pub fn document_v2(record_key: RecordKey, is_email_attachment: bool) -> Self {
        Self {
            record_key,
            target_profile: vocabulary::profile_v2(),
            partition: vocabulary::document_partition(),
            facts: SoupCacheProjectionFacts::Document {
                is_email_attachment,
                is_important: None,
                status_option_ids: None,
            },
        }
    }

    /// Construct the current v3 supplement for authoritative document state.
    pub fn document(
        record_key: RecordKey,
        is_email_attachment: bool,
        is_important: bool,
        mut status_option_ids: Vec<Uuid>,
    ) -> Self {
        status_option_ids.sort_unstable();
        status_option_ids.dedup();
        Self {
            record_key,
            target_profile: vocabulary::profile_v3(),
            partition: vocabulary::document_partition(),
            facts: SoupCacheProjectionFacts::Document {
                is_email_attachment,
                is_important: Some(is_important),
                status_option_ids: Some(status_option_ids),
            },
        }
    }

    /// Construct a Mail supplement containing server-only filter and sort facts.
    pub fn mail(record_key: RecordKey, facts: MailCacheProjectionFacts) -> Self {
        Self {
            record_key,
            target_profile: item_filter_index::mail::profile(),
            partition: item_filter_index::mail::partition(),
            facts: SoupCacheProjectionFacts::Mail(facts),
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

    /// Read the authoritative email-attachment relation fact for a document.
    pub fn is_email_attachment(&self) -> Option<bool> {
        match &self.facts {
            SoupCacheProjectionFacts::Document {
                is_email_attachment,
                ..
            } => Some(*is_email_attachment),
            SoupCacheProjectionFacts::Mail(_) => None,
        }
    }

    /// Read viewer-relative document importance when supplied by this wire version.
    pub fn is_important(&self) -> Option<bool> {
        match &self.facts {
            SoupCacheProjectionFacts::Document { is_important, .. } => *is_important,
            SoupCacheProjectionFacts::Mail(_) => None,
        }
    }

    /// Read the complete task Status option set when supplied by this wire version.
    pub fn status_option_ids(&self) -> Option<&[Uuid]> {
        match &self.facts {
            SoupCacheProjectionFacts::Document {
                status_option_ids, ..
            } => status_option_ids.as_deref(),
            SoupCacheProjectionFacts::Mail(_) => None,
        }
    }

    /// Read Mail-specific server facts when this supplement targets Mail.
    pub fn mail_facts(&self) -> Option<&MailCacheProjectionFacts> {
        match &self.facts {
            SoupCacheProjectionFacts::Mail(facts) => Some(facts),
            SoupCacheProjectionFacts::Document { .. } => None,
        }
    }
}

/// Immutable postcard payload for one v2-profile server-fact supplement.
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

/// Immutable postcard payload for one v3-profile server-fact supplement.
///
/// Field order is wire-significant and locked by cross-adapter golden fixtures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoupCacheProjectionCapsuleV2 {
    /// Complete projection profile to which these server facts may be applied.
    pub target_profile: String,
    /// Defensive normalized-record binding.
    pub record_key: String,
    /// Defensive entity-partition binding.
    pub partition: String,
    /// Explicit authoritative `document_email` membership state.
    pub is_email_attachment: bool,
    /// Viewer-relative importance state.
    pub is_important: bool,
    /// Complete canonical task Status select-option UUID set.
    pub status_option_ids: Vec<Uuid>,
}

/// Immutable postcard payload for a Mail server-fact supplement.
///
/// Field order is wire-significant and locked by cross-adapter golden fixtures.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SoupCacheProjectionCapsuleV3 {
    /// Complete Mail projection profile to which these facts may be applied.
    pub target_profile: String,
    /// Defensive normalized-record binding.
    pub record_key: String,
    /// Defensive entity-partition binding.
    pub partition: String,
    /// Canonical ALL-view timestamp in microseconds.
    pub latest_non_spam_message_ts: Option<i64>,
    /// Canonical SENT-view timestamp in microseconds.
    pub latest_outbound_message_ts: Option<i64>,
    /// Authoritative Calendar-tab classification.
    pub has_calendar_attachment: bool,
    /// Viewer-relative direct-share fact.
    pub has_thread_share: bool,
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
    /// Bytes remain after decoding the immutable postcard value.
    #[error("Soup cache-projection supplement contains trailing bytes")]
    TrailingBytes,
    /// A storage-neutral token or key bound is invalid.
    #[error(transparent)]
    GenericValidation(#[from] ValidationError),
    /// The supplement targets a projection profile not understood by its wire contract.
    #[error("unsupported Soup cache-projection target profile `{0}`")]
    UnsupportedTargetProfile(String),
    /// The supplement declares a partition that has no server-only facts.
    #[error("unsupported Soup cache-projection supplement partition `{0}`")]
    UnsupportedPartition(String),
    /// The defensive record key does not identify an entity in the declared partition.
    #[error("Soup cache-projection record key does not match its entity partition")]
    RecordKeyPartitionMismatch,
    /// The status set is oversized or not in canonical sorted, deduplicated order.
    #[error("Soup cache-projection Status option IDs are not canonical")]
    NonCanonicalStatusOptionIds,
}

/// Encode one canonical server-fact supplement as standard unpadded base64
/// over a version byte and the matching immutable postcard payload.
pub fn encode_cache_projection_supplement(
    supplement: &SoupCacheProjectionSupplement,
) -> Result<String, SoupCacheProjectionWireError> {
    validate_supplement(supplement)?;
    let (version, payload) = if supplement.target_profile == vocabulary::profile_v2() {
        let capsule = SoupCacheProjectionCapsuleV1::try_from(supplement)?;
        (
            SOUP_CACHE_PROJECTION_WIRE_VERSION_V1,
            postcard::to_stdvec(&capsule).map_err(SoupCacheProjectionWireError::InvalidPostcard)?,
        )
    } else if supplement.target_profile == vocabulary::profile_v3() {
        let capsule = SoupCacheProjectionCapsuleV2::try_from(supplement)?;
        (
            SOUP_CACHE_PROJECTION_WIRE_VERSION_V2,
            postcard::to_stdvec(&capsule).map_err(SoupCacheProjectionWireError::InvalidPostcard)?,
        )
    } else {
        let capsule = SoupCacheProjectionCapsuleV3::try_from(supplement)?;
        (
            SOUP_CACHE_PROJECTION_WIRE_VERSION_V3,
            postcard::to_stdvec(&capsule).map_err(SoupCacheProjectionWireError::InvalidPostcard)?,
        )
    };
    let decoded_len = payload.len().saturating_add(1);
    if decoded_len > MAX_SOUP_CACHE_PROJECTION_BYTES {
        return Err(SoupCacheProjectionWireError::DecodedTooLarge);
    }

    let mut framed = Vec::with_capacity(decoded_len);
    framed.push(version);
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

    match version {
        SOUP_CACHE_PROJECTION_WIRE_VERSION_V1 => {
            decode_postcard::<SoupCacheProjectionCapsuleV1>(payload)?.try_into()
        }
        SOUP_CACHE_PROJECTION_WIRE_VERSION_V2 => {
            decode_postcard::<SoupCacheProjectionCapsuleV2>(payload)?.try_into()
        }
        SOUP_CACHE_PROJECTION_WIRE_VERSION_V3 => {
            decode_postcard::<SoupCacheProjectionCapsuleV3>(payload)?.try_into()
        }
        version => Err(SoupCacheProjectionWireError::UnsupportedWireVersion(
            version,
        )),
    }
}

fn decode_postcard<T>(payload: &[u8]) -> Result<T, SoupCacheProjectionWireError>
where
    T: for<'de> Deserialize<'de>,
{
    let (capsule, trailing) = postcard::take_from_bytes::<T>(payload)
        .map_err(SoupCacheProjectionWireError::InvalidPostcard)?;
    if !trailing.is_empty() {
        return Err(SoupCacheProjectionWireError::TrailingBytes);
    }
    Ok(capsule)
}

impl TryFrom<&SoupCacheProjectionSupplement> for SoupCacheProjectionCapsuleV1 {
    type Error = SoupCacheProjectionWireError;

    fn try_from(supplement: &SoupCacheProjectionSupplement) -> Result<Self, Self::Error> {
        if supplement.target_profile != vocabulary::profile_v2() {
            return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                supplement.target_profile.token().as_str().to_owned(),
            ));
        }
        Ok(Self {
            target_profile: supplement.target_profile.token().as_str().to_owned(),
            record_key: supplement.record_key.as_str().to_owned(),
            partition: supplement.partition.as_str().to_owned(),
            is_email_attachment: supplement.is_email_attachment().ok_or(
                SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ),
            )?,
        })
    }
}

impl TryFrom<&SoupCacheProjectionSupplement> for SoupCacheProjectionCapsuleV2 {
    type Error = SoupCacheProjectionWireError;

    fn try_from(supplement: &SoupCacheProjectionSupplement) -> Result<Self, Self::Error> {
        if supplement.target_profile != vocabulary::profile_v3() {
            return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                supplement.target_profile.token().as_str().to_owned(),
            ));
        }
        Ok(Self {
            target_profile: supplement.target_profile.token().as_str().to_owned(),
            record_key: supplement.record_key.as_str().to_owned(),
            partition: supplement.partition.as_str().to_owned(),
            is_email_attachment: supplement.is_email_attachment().ok_or(
                SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ),
            )?,
            is_important: supplement.is_important().ok_or(
                SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ),
            )?,
            status_option_ids: supplement
                .status_option_ids()
                .ok_or(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ))?
                .to_vec(),
        })
    }
}

impl TryFrom<&SoupCacheProjectionSupplement> for SoupCacheProjectionCapsuleV3 {
    type Error = SoupCacheProjectionWireError;

    fn try_from(supplement: &SoupCacheProjectionSupplement) -> Result<Self, Self::Error> {
        if supplement.target_profile != item_filter_index::mail::profile() {
            return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                supplement.target_profile.token().as_str().to_owned(),
            ));
        }
        let facts = supplement.mail_facts().ok_or(
            SoupCacheProjectionWireError::UnsupportedTargetProfile(
                supplement.target_profile.token().as_str().to_owned(),
            ),
        )?;
        Ok(Self {
            target_profile: supplement.target_profile.token().as_str().to_owned(),
            record_key: supplement.record_key.as_str().to_owned(),
            partition: supplement.partition.as_str().to_owned(),
            latest_non_spam_message_ts: facts.latest_non_spam_message_ts(),
            latest_outbound_message_ts: facts.latest_outbound_message_ts(),
            has_calendar_attachment: facts.has_calendar_attachment(),
            has_thread_share: facts.has_thread_share(),
        })
    }
}

impl TryFrom<SoupCacheProjectionCapsuleV1> for SoupCacheProjectionSupplement {
    type Error = SoupCacheProjectionWireError;

    fn try_from(capsule: SoupCacheProjectionCapsuleV1) -> Result<Self, Self::Error> {
        let supplement = Self {
            record_key: RecordKey::new(capsule.record_key)?,
            target_profile: Profile::new(Token::new(capsule.target_profile)?),
            partition: Token::new(capsule.partition)?,
            facts: SoupCacheProjectionFacts::Document {
                is_email_attachment: capsule.is_email_attachment,
                is_important: None,
                status_option_ids: None,
            },
        };
        validate_supplement(&supplement)?;
        Ok(supplement)
    }
}

impl TryFrom<SoupCacheProjectionCapsuleV2> for SoupCacheProjectionSupplement {
    type Error = SoupCacheProjectionWireError;

    fn try_from(capsule: SoupCacheProjectionCapsuleV2) -> Result<Self, Self::Error> {
        let supplement = Self {
            record_key: RecordKey::new(capsule.record_key)?,
            target_profile: Profile::new(Token::new(capsule.target_profile)?),
            partition: Token::new(capsule.partition)?,
            facts: SoupCacheProjectionFacts::Document {
                is_email_attachment: capsule.is_email_attachment,
                is_important: Some(capsule.is_important),
                status_option_ids: Some(capsule.status_option_ids),
            },
        };
        validate_supplement(&supplement)?;
        Ok(supplement)
    }
}

impl TryFrom<SoupCacheProjectionCapsuleV3> for SoupCacheProjectionSupplement {
    type Error = SoupCacheProjectionWireError;

    fn try_from(capsule: SoupCacheProjectionCapsuleV3) -> Result<Self, Self::Error> {
        let supplement = Self {
            record_key: RecordKey::new(capsule.record_key)?,
            target_profile: Profile::new(Token::new(capsule.target_profile)?),
            partition: Token::new(capsule.partition)?,
            facts: SoupCacheProjectionFacts::Mail(MailCacheProjectionFacts::new(
                capsule.latest_non_spam_message_ts,
                capsule.latest_outbound_message_ts,
                capsule.has_calendar_attachment,
                capsule.has_thread_share,
            )),
        };
        validate_supplement(&supplement)?;
        Ok(supplement)
    }
}

fn validate_supplement(
    supplement: &SoupCacheProjectionSupplement,
) -> Result<(), SoupCacheProjectionWireError> {
    let record_prefix = match &supplement.facts {
        SoupCacheProjectionFacts::Document {
            is_important,
            status_option_ids,
            ..
        } => {
            if supplement.target_profile == vocabulary::profile_v2() {
                if is_important.is_some() || status_option_ids.is_some() {
                    return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                        supplement.target_profile.token().as_str().to_owned(),
                    ));
                }
            } else if supplement.target_profile == vocabulary::profile_v3() {
                let Some(status_option_ids) = status_option_ids.as_deref() else {
                    return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                        supplement.target_profile.token().as_str().to_owned(),
                    ));
                };
                if is_important.is_none()
                    || status_option_ids.len() > crate::MAX_TASK_STATUS_OPTION_IDS
                    || !status_option_ids.windows(2).all(|ids| ids[0] < ids[1])
                {
                    return Err(SoupCacheProjectionWireError::NonCanonicalStatusOptionIds);
                }
            } else {
                return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ));
            }
            if supplement.partition != vocabulary::document_partition() {
                return Err(SoupCacheProjectionWireError::UnsupportedPartition(
                    supplement.partition.as_str().to_owned(),
                ));
            }
            "GraphqlSoupDocument:"
        }
        SoupCacheProjectionFacts::Mail(_) => {
            if supplement.target_profile != item_filter_index::mail::profile() {
                return Err(SoupCacheProjectionWireError::UnsupportedTargetProfile(
                    supplement.target_profile.token().as_str().to_owned(),
                ));
            }
            if supplement.partition != item_filter_index::mail::partition() {
                return Err(SoupCacheProjectionWireError::UnsupportedPartition(
                    supplement.partition.as_str().to_owned(),
                ));
            }
            "GraphqlSoupEmailThread:"
        }
    };
    if !supplement.record_key.as_str().starts_with(record_prefix) {
        return Err(SoupCacheProjectionWireError::RecordKeyPartitionMismatch);
    }
    Ok(())
}
