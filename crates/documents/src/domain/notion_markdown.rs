//! A Notion page body, in Notion's enhanced markdown, with what its page and
//! people references resolve to in Macro. Converted to document content by
//! lexical-service rather than parsed here.

use std::collections::HashMap;

/// A Notion page body and where its references point.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotionMarkdown {
    /// Page-local database card placements.
    pub databases: Vec<NotionDatabaseOccurrence>,

    /// The page in Notion's enhanced markdown.
    pub markdown: String,
    /// Notion page id (dashless, lowercase) → the Macro document it became.
    pub pages: HashMap<String, NotionPageLink>,
    /// Notion user id (dashless, lowercase) → the Macro user they are.
    pub users: HashMap<String, NotionUserLink>,
}

/// The Macro document a Notion page became.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionPageLink {
    /// The document id.
    pub document_id: uuid::Uuid,
    /// Its name.
    pub name: String,
}

/// The Macro user a Notion person is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionUserLink {
    /// The Macro user id.
    pub user_id: String,
    /// Their email.
    pub email: String,
}

/// A page-local database placement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionDatabaseOccurrence {
    /// Normalized external container identity.
    pub container_id: String,
    /// Placement number for this container.
    pub ordinal: usize,
    /// Card destination or named source fallback.
    pub target: NotionDatabaseTarget,
}

/// A card requires both destination database and table identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotionDatabaseTarget {
    /// Existing editable database.
    Resolved {
        /// Database identity.
        database_id: uuid::Uuid,
        /// Table identity.
        table_id: uuid::Uuid,
        /// Translated saved view.
        view_id: Option<uuid::Uuid>,
    },
    /// Retained source link.
    Fallback {
        /// Why this placement could not become a card.
        reason: NotionDatabaseFallback,
    },
}

/// Reasons accepted by the database card converter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotionDatabaseFallback {
    /// The connection cannot read it.
    NoAccess,
    /// The source is missing.
    NotFound,
    /// The review did not import it as a database.
    NotImported,
    /// No unambiguous destination could be chosen.
    Unresolved,
}
