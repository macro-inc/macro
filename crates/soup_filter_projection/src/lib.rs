//! Direct-field Soup projection helpers and typed server-fact supplements.
#![deny(missing_docs)]

use std::str::FromStr;

use item_filter_index::vocabulary;
use model_file_type::FileType;
#[cfg(feature = "models")]
use models_soup::{chat::SoupChat, document::SoupDocument, item::SoupItem, project::SoupProject};
use predicate_index::{
    ExactAttributePatch, ExactFact, ExactValue, IndexDocument, IntegerAttributePatch, IntegerFact,
    OptimisticProjectionMutation, RecordKey, Token, ValidationError, utc_timestamp_micros,
};
#[cfg(feature = "models")]
use soup::domain::models::SoupProjectionHydration;
use thiserror::Error;

mod profile;
mod wire;

pub use profile::{ProfileValidationError, validate_soup_flat_v2};
pub use wire::{
    MAX_SOUP_CACHE_PROJECTION_BYTES, MAX_SOUP_CACHE_PROJECTION_ENCODED_BYTES,
    SOUP_CACHE_PROJECTION_WIRE_VERSION, SoupCacheProjectionCapsuleV1,
    SoupCacheProjectionSupplement, SoupCacheProjectionWireError,
    decode_cache_projection_supplement, encode_cache_projection_supplement,
};

#[cfg(test)]
mod test;

/// Failure to project an authoritative Soup item.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProjectionError {
    /// The authoritative document contained an unknown file-type value.
    #[error("invalid authoritative Soup document file type `{0}`")]
    InvalidFileType(String),
    /// Document server facts do not match the accompanying item variant.
    #[error("document server facts do not match Soup item variant")]
    SourceMismatch,
    /// The generic projection violated bounded IR invariants.
    #[error(transparent)]
    Validation(#[from] ValidationError),
}

/// Supported direct-field Soup entity kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoupFlatEntityKind {
    /// Document projection.
    Document,
    /// Project projection.
    Project,
    /// Chat projection.
    Chat,
}

impl SoupFlatEntityKind {
    fn partition(self) -> Token {
        match self {
            Self::Document => vocabulary::document_partition(),
            Self::Project => vocabulary::project_partition(),
            Self::Chat => vocabulary::chat_partition(),
        }
    }
}

/// Complete direct fields needed to create an optimistic `soup-flat-v1` projection.
#[derive(Debug, Clone)]
pub struct DirectProjectionInput {
    /// Normalized record key.
    pub record_key: RecordKey,
    /// Supported Soup entity kind.
    pub kind: SoupFlatEntityKind,
    /// Entity UUID.
    pub id: uuid::Uuid,
    /// Canonical owner identifier.
    pub owner: String,
    /// Project or parent UUID, when present.
    pub project_id: Option<uuid::Uuid>,
    /// Document file type, when present. Ignored for other kinds.
    pub file_type: Option<String>,
    /// Creation timestamp.
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Effective optimistic update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Partial direct fields changed by one optimistic mutation.
#[derive(Debug, Clone)]
pub struct DirectProjectionPatchInput {
    /// Normalized record key.
    pub record_key: RecordKey,
    /// Supported Soup entity kind.
    pub kind: SoupFlatEntityKind,
    /// Replacement owner when supplied.
    pub owner: Option<String>,
    /// Replacement project/parent value. Outer `None` means unchanged.
    pub project_id: Option<Option<uuid::Uuid>>,
    /// Replacement document file type. Outer `None` means unchanged.
    pub file_type: Option<Option<String>>,
    /// Replacement creation timestamp when supplied.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Effective optimistic update timestamp.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Generate a complete optimistic projection from direct Soup fields.
pub fn project_direct_fields(
    input: DirectProjectionInput,
) -> Result<IndexDocument, ProjectionError> {
    let mut exact_facts = common_exact_facts(input.id, input.owner)?;
    if let Some(project_id) = input.project_id {
        exact_facts.push(uuid_fact(vocabulary::project_id(), project_id)?);
    }
    if input.kind == SoupFlatEntityKind::Document
        && let Some(file_type) = input.file_type
    {
        let canonical = FileType::from_str(&file_type)
            .map_err(|_| ProjectionError::InvalidFileType(file_type))?
            .to_string();
        exact_facts.push(utf8_fact(vocabulary::file_type(), canonical)?);
    }
    projection(
        input.record_key,
        vocabulary::profile(),
        input.kind.partition(),
        exact_facts,
        input.created_at,
        input.updated_at,
    )
}

/// Generate a generic optimistic patch from partial direct Soup fields.
pub fn patch_direct_fields(
    input: DirectProjectionPatchInput,
) -> Result<OptimisticProjectionMutation, ProjectionError> {
    let mut exact = Vec::new();
    if let Some(owner) = input.owner {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::owner(),
            values: vec![ExactValue::utf8(owner)?],
        });
    }
    if let Some(project_id) = input.project_id {
        exact.push(ExactAttributePatch {
            attribute: vocabulary::project_id(),
            values: project_id
                .map(|project_id| ExactValue::new(project_id.as_bytes()))
                .transpose()?
                .into_iter()
                .collect(),
        });
    }
    if input.kind == SoupFlatEntityKind::Document
        && let Some(file_type) = input.file_type
    {
        let values = file_type
            .map(|file_type| -> Result<ExactValue, ProjectionError> {
                let canonical = FileType::from_str(&file_type)
                    .map_err(|_| ProjectionError::InvalidFileType(file_type))?
                    .to_string();
                Ok(ExactValue::utf8(canonical)?)
            })
            .transpose()?
            .into_iter()
            .collect();
        exact.push(ExactAttributePatch {
            attribute: vocabulary::file_type(),
            values,
        });
    }

    let mut integers = Vec::new();
    let mut sorts = Vec::new();
    if let Some(created_at) = input.created_at {
        let value = utc_timestamp_micros(created_at);
        integers.push(IntegerAttributePatch {
            attribute: vocabulary::created_at(),
            values: vec![value],
        });
        sorts.push(IntegerFact {
            attribute: vocabulary::created_at(),
            value,
        });
    }
    let updated_at = utc_timestamp_micros(input.updated_at);
    integers.push(IntegerAttributePatch {
        attribute: vocabulary::updated_at(),
        values: vec![updated_at],
    });
    sorts.push(IntegerFact {
        attribute: vocabulary::updated_at(),
        value: updated_at,
    });

    Ok(OptimisticProjectionMutation::Patch {
        record_key: input.record_key,
        profile: vocabulary::profile(),
        partition: input.kind.partition(),
        exact,
        integers,
        sorts,
    })
}

#[cfg(feature = "models")]
/// Project a supported authoritative Soup item using a caller-supplied normalized key.
///
/// Deferred entity variants return `None` and are never represented as complete
/// `soup-flat-v1` index documents.
pub fn project_soup_item<T>(
    record_key: RecordKey,
    item: &SoupItem<T>,
) -> Result<Option<IndexDocument>, ProjectionError> {
    match item {
        SoupItem::Document(document) => project_document(record_key, document).map(Some),
        SoupItem::Project(project) => project_project(record_key, project).map(Some),
        SoupItem::Chat(chat) => project_chat(record_key, chat).map(Some),
        SoupItem::EmailThread(_)
        | SoupItem::Channel(_)
        | SoupItem::ChannelThread(_)
        | SoupItem::Call(_)
        | SoupItem::CalendarEvent(_)
        | SoupItem::CrmCompany(_)
        | SoupItem::ForeignEntity(_)
        | SoupItem::Reminder(_) => Ok(None),
    }
}

/// Project direct Document fields required by `soup-flat-v1`.
#[cfg(feature = "models")]
pub fn project_document<T>(
    record_key: RecordKey,
    document: &SoupDocument<T>,
) -> Result<IndexDocument, ProjectionError> {
    project_direct_fields(DirectProjectionInput {
        record_key,
        kind: SoupFlatEntityKind::Document,
        id: document.id,
        owner: document.owner_id.to_string(),
        project_id: document.project_id,
        file_type: document.file_type.clone(),
        created_at: document.created_at,
        updated_at: document.updated_at,
    })
}

/// Project direct Project fields required by `soup-flat-v1`.
#[cfg(feature = "models")]
pub fn project_project<T>(
    record_key: RecordKey,
    project: &SoupProject<T>,
) -> Result<IndexDocument, ProjectionError> {
    project_direct_fields(DirectProjectionInput {
        record_key,
        kind: SoupFlatEntityKind::Project,
        id: project.id,
        owner: project.owner_id.to_string(),
        project_id: project.parent_id,
        file_type: None,
        created_at: project.created_at,
        updated_at: project.updated_at,
    })
}

/// Project direct Chat fields required by `soup-flat-v1`.
#[cfg(feature = "models")]
pub fn project_chat<T>(
    record_key: RecordKey,
    chat: &SoupChat<T>,
) -> Result<IndexDocument, ProjectionError> {
    project_direct_fields(DirectProjectionInput {
        record_key,
        kind: SoupFlatEntityKind::Chat,
        id: chat.id,
        owner: chat.owner_id.to_string(),
        project_id: chat.project_id,
        file_type: None,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
    })
}

/// Compile an authorized item/server-facts pair into a typed supplement.
///
/// Only documents hydrated with authoritative `document_email` relation state
/// produce a supplement. Direct entity fields, including document subtype,
/// are deliberately excluded and must be projected from the same GraphQL
/// response by the browser. A document supplement attached to another entity
/// variant is rejected.
#[cfg(feature = "models")]
pub fn project_soup_cache_supplement(
    record_key: RecordKey,
    hydration: &SoupProjectionHydration,
) -> Result<Option<SoupCacheProjectionSupplement>, ProjectionError> {
    let Some(server_facts) = hydration.document_server_facts else {
        return Ok(None);
    };
    if !matches!(&hydration.item, SoupItem::Document(_)) {
        return Err(ProjectionError::SourceMismatch);
    }
    Ok(Some(SoupCacheProjectionSupplement::document(
        record_key,
        server_facts.is_email_attachment,
    )))
}

fn common_exact_facts(id: uuid::Uuid, owner: String) -> Result<Vec<ExactFact>, ValidationError> {
    Ok(vec![
        uuid_fact(vocabulary::id(), id)?,
        utf8_fact(vocabulary::owner(), owner)?,
    ])
}

fn projection(
    record_key: RecordKey,
    profile: predicate_index::Profile,
    partition: Token,
    exact_facts: Vec<ExactFact>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
) -> Result<IndexDocument, ProjectionError> {
    let created_at = IntegerFact {
        attribute: vocabulary::created_at(),
        value: utc_timestamp_micros(created_at),
    };
    let updated_at = IntegerFact {
        attribute: vocabulary::updated_at(),
        value: utc_timestamp_micros(updated_at),
    };
    let document = IndexDocument {
        record_key,
        profile,
        partition,
        exact_facts,
        integer_facts: vec![created_at.clone(), updated_at.clone()],
        sort_facts: vec![created_at, updated_at],
    };
    document.validate()?;
    Ok(document)
}

fn uuid_fact(attribute: Token, value: uuid::Uuid) -> Result<ExactFact, ValidationError> {
    Ok(ExactFact {
        attribute,
        value: ExactValue::new(value.as_bytes())?,
    })
}

fn utf8_fact(attribute: Token, value: impl AsRef<str>) -> Result<ExactFact, ValidationError> {
    Ok(ExactFact {
        attribute,
        value: ExactValue::utf8(value)?,
    })
}
