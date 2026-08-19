//! Versioned direct-field Soup projections for `soup-flat-v1`.
#![deny(missing_docs)]

use std::str::FromStr;

use item_filter_index::vocabulary;
use model_file_type::FileType;
use models_soup::{chat::SoupChat, document::SoupDocument, item::SoupItem, project::SoupProject};
use predicate_index::{
    ExactFact, ExactValue, IndexDocument, IntegerFact, RecordKey, Token, ValidationError,
    utc_timestamp_micros,
};
use thiserror::Error;

#[cfg(test)]
mod test;

/// Failure to project an authoritative Soup item.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProjectionError {
    /// The authoritative document contained an unknown file-type value.
    #[error("invalid authoritative Soup document file type `{0}`")]
    InvalidFileType(String),
    /// The generic projection violated bounded IR invariants.
    #[error(transparent)]
    Validation(#[from] ValidationError),
}

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
pub fn project_document<T>(
    record_key: RecordKey,
    document: &SoupDocument<T>,
) -> Result<IndexDocument, ProjectionError> {
    let mut exact_facts = common_exact_facts(document.id, document.owner_id.to_string())?;
    if let Some(project_id) = document.project_id {
        exact_facts.push(uuid_fact(vocabulary::project_id(), project_id)?);
    }
    if let Some(file_type) = document.file_type.as_deref() {
        let canonical = FileType::from_str(file_type)
            .map_err(|_| ProjectionError::InvalidFileType(file_type.to_owned()))?
            .to_string();
        exact_facts.push(utf8_fact(vocabulary::file_type(), canonical)?);
    }

    projection(
        record_key,
        vocabulary::document_partition(),
        exact_facts,
        document.created_at,
        document.updated_at,
    )
}

/// Project direct Project fields required by `soup-flat-v1`.
pub fn project_project<T>(
    record_key: RecordKey,
    project: &SoupProject<T>,
) -> Result<IndexDocument, ProjectionError> {
    let mut exact_facts = common_exact_facts(project.id, project.owner_id.to_string())?;
    if let Some(parent_id) = project.parent_id {
        exact_facts.push(uuid_fact(vocabulary::project_id(), parent_id)?);
    }

    projection(
        record_key,
        vocabulary::project_partition(),
        exact_facts,
        project.created_at,
        project.updated_at,
    )
}

/// Project direct Chat fields required by `soup-flat-v1`.
pub fn project_chat<T>(
    record_key: RecordKey,
    chat: &SoupChat<T>,
) -> Result<IndexDocument, ProjectionError> {
    let mut exact_facts = common_exact_facts(chat.id, chat.owner_id.to_string())?;
    if let Some(project_id) = chat.project_id {
        exact_facts.push(uuid_fact(vocabulary::project_id(), project_id)?);
    }

    projection(
        record_key,
        vocabulary::chat_partition(),
        exact_facts,
        chat.created_at,
        chat.updated_at,
    )
}

fn common_exact_facts(id: uuid::Uuid, owner: String) -> Result<Vec<ExactFact>, ValidationError> {
    Ok(vec![
        uuid_fact(vocabulary::id(), id)?,
        utf8_fact(vocabulary::owner(), owner)?,
    ])
}

fn projection(
    record_key: RecordKey,
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
        profile: vocabulary::profile(),
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
