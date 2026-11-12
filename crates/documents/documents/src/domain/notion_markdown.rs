//! A Notion page body, in Notion's enhanced markdown, with what its page and
//! people references resolve to in Macro. Converted to document content by
//! lexical-service rather than parsed here.

use std::collections::HashMap;

/// A Notion page body and where its references point.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NotionMarkdown {
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
