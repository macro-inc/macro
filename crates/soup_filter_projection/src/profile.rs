use std::str::FromStr;

use item_filter_index::vocabulary;
use model_file_type::FileType;
use predicate_index::{ExactFact, IndexDocument, IntegerFact, Token, ValidationError};
use thiserror::Error;

/// Semantic validation failure for one complete versioned Soup document.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProfileValidationError {
    /// Generic storage-neutral document bounds were violated.
    #[error(transparent)]
    Generic(#[from] ValidationError),
    /// The complete document declares a profile other than the expected version.
    #[error("unsupported Soup projection profile `{0}`")]
    UnsupportedProfile(String),
    /// The complete document declares a partition outside the supported profiles.
    #[error("unsupported Soup projection partition `{0}`")]
    UnsupportedPartition(String),
    /// A fact attribute is not allowed for this partition and profile.
    #[error("unexpected {family} fact attribute `{attribute}`")]
    UnexpectedAttribute {
        /// Fact family containing the unexpected attribute.
        family: &'static str,
        /// Unexpected attribute token.
        attribute: String,
    },
    /// A required fact is absent.
    #[error("missing required Soup projection fact `{0}`")]
    MissingRequired(&'static str),
    /// A single-valued fact occurs more than once.
    #[error("duplicate Soup projection fact `{0}`")]
    Duplicate(&'static str),
    /// A fact uses a malformed canonical value.
    #[error("invalid canonical value for Soup projection fact `{0}")]
    InvalidValue(&'static str),
    /// A multi-valued fact exceeds its profile-specific bound.
    #[error("too many values for Soup projection fact `{0}")]
    TooManyValues(&'static str),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProfileVersion {
    V2,
    V3,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PartitionKind {
    Document,
    Project,
    Chat,
}

/// Validate strict Soup-specific completeness and canonical value semantics for
/// one composed `soup-flat-v2` index document.
pub fn validate_soup_flat_v2(document: &IndexDocument) -> Result<(), ProfileValidationError> {
    validate_soup_flat(document, ProfileVersion::V2)
}

/// Validate strict Soup-specific completeness and canonical value semantics for
/// one composed `soup-flat-v3` index document.
pub fn validate_soup_flat_v3(document: &IndexDocument) -> Result<(), ProfileValidationError> {
    validate_soup_flat(document, ProfileVersion::V3)
}

fn validate_soup_flat(
    document: &IndexDocument,
    version: ProfileVersion,
) -> Result<(), ProfileValidationError> {
    document.validate()?;
    let expected_profile = match version {
        ProfileVersion::V2 => vocabulary::profile_v2(),
        ProfileVersion::V3 => vocabulary::profile_v3(),
    };
    if document.profile != expected_profile {
        return Err(ProfileValidationError::UnsupportedProfile(
            document.profile.token().as_str().to_owned(),
        ));
    }

    let kind = if document.partition == vocabulary::document_partition() {
        PartitionKind::Document
    } else if document.partition == vocabulary::project_partition() {
        PartitionKind::Project
    } else if document.partition == vocabulary::chat_partition() {
        PartitionKind::Chat
    } else {
        return Err(ProfileValidationError::UnsupportedPartition(
            document.partition.as_str().to_owned(),
        ));
    };

    validate_exact_facts(version, kind, &document.exact_facts)?;
    validate_integer_family("integer", &document.integer_facts)?;
    validate_integer_family("sort", &document.sort_facts)?;
    Ok(())
}

fn validate_exact_facts(
    version: ProfileVersion,
    kind: PartitionKind,
    facts: &[ExactFact],
) -> Result<(), ProfileValidationError> {
    let mut id = 0;
    let mut owner = 0;
    let mut project_id = 0;
    let mut file_type = 0;
    let mut sub_type = 0;
    let mut email_attachment = 0;
    let mut importance = 0;
    let mut status_options = 0;

    for fact in facts {
        let attribute = &fact.attribute;
        let value = fact.value.as_bytes();
        if attribute == &vocabulary::id() {
            id += 1;
            if value.len() != 16 {
                return Err(ProfileValidationError::InvalidValue("id"));
            }
        } else if attribute == &vocabulary::owner() {
            owner += 1;
            if value.is_empty() || std::str::from_utf8(value).is_err() {
                return Err(ProfileValidationError::InvalidValue("owner"));
            }
        } else if attribute == &vocabulary::project_id() {
            project_id += 1;
            if value.len() != 16 {
                return Err(ProfileValidationError::InvalidValue("project-id"));
            }
        } else if attribute == &vocabulary::file_type() && kind == PartitionKind::Document {
            file_type += 1;
            let value = std::str::from_utf8(value)
                .map_err(|_| ProfileValidationError::InvalidValue("file-type"))?;
            if FileType::from_str(value).is_err() {
                return Err(ProfileValidationError::InvalidValue("file-type"));
            }
        } else if attribute == &vocabulary::document_sub_type() && kind == PartitionKind::Document {
            sub_type += 1;
            if !matches!(value, b"task" | b"snippet" | b"skill") {
                return Err(ProfileValidationError::InvalidValue("document-sub-type"));
            }
        } else if attribute == &vocabulary::email_attachment() && kind == PartitionKind::Document {
            email_attachment += 1;
            if !matches!(value, [0] | [1]) {
                return Err(ProfileValidationError::InvalidValue("email-attachment"));
            }
        } else if version == ProfileVersion::V3
            && attribute == &vocabulary::importance()
            && kind == PartitionKind::Document
        {
            importance += 1;
            if !matches!(value, [0] | [1]) {
                return Err(ProfileValidationError::InvalidValue("importance"));
            }
        } else if version == ProfileVersion::V3
            && attribute == &vocabulary::task_status_option()
            && kind == PartitionKind::Document
        {
            status_options += 1;
            if value.len() != 16 {
                return Err(ProfileValidationError::InvalidValue("task-status-option"));
            }
        } else {
            return Err(unexpected("exact", attribute));
        }
    }

    require_one("id", id)?;
    require_one("owner", owner)?;
    allow_at_most_one("project-id", project_id)?;
    allow_at_most_one("file-type", file_type)?;
    allow_at_most_one("document-sub-type", sub_type)?;
    match kind {
        PartitionKind::Document => {
            require_one("email-attachment", email_attachment)?;
            if version == ProfileVersion::V3 {
                require_one("importance", importance)?;
                if status_options > crate::MAX_TASK_STATUS_OPTION_IDS {
                    return Err(ProfileValidationError::TooManyValues("task-status-option"));
                }
            }
        }
        PartitionKind::Project | PartitionKind::Chat if email_attachment != 0 => {
            return Err(ProfileValidationError::UnexpectedAttribute {
                family: "exact",
                attribute: vocabulary::email_attachment().as_str().to_owned(),
            });
        }
        PartitionKind::Project | PartitionKind::Chat => {}
    }
    Ok(())
}

fn validate_integer_family(
    family: &'static str,
    facts: &[IntegerFact],
) -> Result<(), ProfileValidationError> {
    let mut created_at = 0;
    let mut updated_at = 0;
    for fact in facts {
        if fact.attribute == vocabulary::created_at() {
            created_at += 1;
        } else if fact.attribute == vocabulary::updated_at() {
            updated_at += 1;
        } else {
            return Err(unexpected(family, &fact.attribute));
        }
    }
    require_one("created-at", created_at)?;
    require_one("updated-at", updated_at)?;
    Ok(())
}

fn require_one(name: &'static str, count: usize) -> Result<(), ProfileValidationError> {
    match count {
        0 => Err(ProfileValidationError::MissingRequired(name)),
        1 => Ok(()),
        _ => Err(ProfileValidationError::Duplicate(name)),
    }
}

fn allow_at_most_one(name: &'static str, count: usize) -> Result<(), ProfileValidationError> {
    if count <= 1 {
        Ok(())
    } else {
        Err(ProfileValidationError::Duplicate(name))
    }
}

fn unexpected(family: &'static str, attribute: &Token) -> ProfileValidationError {
    ProfileValidationError::UnexpectedAttribute {
        family,
        attribute: attribute.as_str().to_owned(),
    }
}
