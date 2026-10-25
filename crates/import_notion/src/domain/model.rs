//! Notion objects as the importer reads them: typed, flattened from the REST
//! API's wire shapes, and stripped of everything an import never uses.

use std::collections::BTreeMap;
use std::fmt;

use chrono::{DateTime, Utc};
use lazy_regex::regex;
use serde::{Deserialize, Serialize};

/// A Notion object id: 32 lowercase hex digits, without dashes.
///
/// Notion accepts and returns ids both with and without dashes, and URLs end
/// in the dashless form after a slug, so ids are normalized on the way in.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct NotionId(String);

impl NotionId {
    /// Parse an id from a raw id (with or without dashes) or a Notion URL
    /// whose last path segment ends in one, such as
    /// `https://www.notion.so/Q3-plan-3fb607323e2e80629886fc0c028d50a7`.
    pub fn parse(input: &str) -> Option<Self> {
        // The id ends the path, with or without its dashes; a query or
        // fragment after it (`?v=…` on a database view) is never the id.
        let captures = regex!(
            r"(?i)^[^?#]*?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/?(?:[?#].*)?$"
        )
        .captures(input.trim())?;
        let hex: String = (1..=5)
            .filter_map(|group| captures.get(group))
            .map(|part| part.as_str().to_ascii_lowercase())
            .collect();
        Some(Self(hex))
    }

    /// The dashless form.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// A canonical link to the object in Notion.
    pub fn url(&self) -> String {
        format!("https://www.notion.so/{}", self.0)
    }
}

impl fmt::Display for NotionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl TryFrom<String> for NotionId {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value).ok_or_else(|| format!("not a Notion id: {value}"))
    }
}

impl From<NotionId> for String {
    fn from(id: NotionId) -> Self {
        id.0
    }
}

/// Where a Notion object sits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotionParent {
    /// At the top of the workspace.
    Workspace,
    /// Under a page.
    Page {
        /// The parent page.
        id: NotionId,
    },
    /// Under a database container (for data sources, and wiki databases).
    Database {
        /// The parent database.
        id: NotionId,
    },
    /// A row of a data source.
    DataSource {
        /// The data source the page is a row of.
        data_source: NotionId,
        /// The database holding that data source.
        database: NotionId,
    },
    /// Inside a block, such as a column; the owning page is further up.
    Block {
        /// The parent block.
        id: NotionId,
    },
    /// A parent kind the importer does not model (for example an agent).
    Other,
}

/// A page, either a standalone document or a data source row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotionPage {
    /// The page id.
    pub id: NotionId,
    /// The plain-text title, empty when the page has none.
    pub title: String,
    /// The page's Notion URL.
    pub url: String,
    /// Where the page sits.
    pub parent: NotionParent,
    /// When the page was last edited.
    pub last_edited: DateTime<Utc>,
    /// When the page was created.
    pub created: DateTime<Utc>,
    /// Whether the page is in Notion's trash.
    pub in_trash: bool,
    /// Property values by property name, title excluded.
    pub properties: BTreeMap<String, NotionValue>,
}

/// A data source: the table behind a Notion database, with its schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotionDataSource {
    /// The data source id.
    pub id: NotionId,
    /// The database container holding this data source.
    pub database_id: NotionId,
    /// The plain-text title.
    pub title: String,
    /// Where the database container sits.
    pub database_parent: NotionParent,
    /// Whether the data source is in Notion's trash.
    pub in_trash: bool,
    /// The columns, in the order Notion returns them, title included.
    pub properties: Vec<NotionPropertySchema>,
}

/// One column of a data source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotionPropertySchema {
    /// Notion's stable property id.
    pub id: String,
    /// The column name.
    pub name: String,
    /// The column's type and its configuration.
    pub kind: NotionPropertyKind,
}

/// A data source column type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotionPropertyKind {
    /// The row title.
    Title,
    /// Formatted text, read as plain text.
    RichText,
    /// A number.
    Number,
    /// One option.
    Select {
        /// The declared options.
        options: Vec<NotionOption>,
    },
    /// Several options.
    MultiSelect {
        /// The declared options.
        options: Vec<NotionOption>,
    },
    /// Notion's workflow status, an option with groups.
    Status {
        /// The declared options.
        options: Vec<NotionOption>,
    },
    /// A date or date range.
    Date,
    /// Workspace members.
    People,
    /// Attached files.
    Files,
    /// A checkbox.
    Checkbox,
    /// A URL.
    Url,
    /// An email address.
    Email,
    /// A phone number.
    PhoneNumber,
    /// A computed value.
    Formula,
    /// Rows of another data source.
    Relation {
        /// The related data source, when Notion reports it.
        data_source_id: Option<NotionId>,
    },
    /// An aggregate over a relation.
    Rollup,
    /// When the row was created.
    CreatedTime,
    /// Who created the row.
    CreatedBy,
    /// When the row was last edited.
    LastEditedTime,
    /// Who last edited the row.
    LastEditedBy,
    /// An auto-incrementing id, such as `TASK-42`.
    UniqueId {
        /// The id prefix, when one is set.
        prefix: Option<String>,
    },
    /// A type the importer does not model; carries Notion's type name.
    Unsupported {
        /// Notion's type name, such as `button`.
        notion_type: String,
    },
}

/// A select, multi-select or status option.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotionOption {
    /// Notion's option id.
    pub id: String,
    /// The label.
    pub name: String,
    /// Notion's color name, such as `blue`.
    pub color: String,
}

/// One property value on a page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum NotionValue {
    /// Title, rich text, or a formula's string result, as plain text.
    Text(String),
    /// A number.
    Number(f64),
    /// A select or status option label.
    Option(String),
    /// Multi-select labels.
    Options(Vec<String>),
    /// A date, or the start and end of a range, as ISO-8601 strings.
    Date {
        /// The start.
        start: String,
        /// The end, for a range.
        end: Option<String>,
    },
    /// Notion user ids.
    People(Vec<NotionId>),
    /// Attached files.
    Files(Vec<NotionFile>),
    /// A checkbox.
    Checkbox(bool),
    /// A URL.
    Url(String),
    /// An email address.
    Email(String),
    /// A phone number.
    Phone(String),
    /// Ids of related pages.
    Relation(Vec<NotionId>),
    /// A timestamp (created or last-edited time), ISO-8601.
    Timestamp(String),
    /// A unique id rendered with its prefix, such as `TASK-42`.
    UniqueId(String),
    /// Several values, from a rollup.
    List(Vec<NotionValue>),
    /// No value.
    Empty,
}

/// A file attached to a page property.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotionFile {
    /// The file's name.
    pub name: String,
    /// Where to download it.
    pub url: String,
    /// When `url` stops working, for files Notion hosts.
    pub expires: Option<DateTime<Utc>>,
}

/// A workspace member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotionUser {
    /// The user id.
    pub id: NotionId,
    /// The display name.
    pub name: Option<String>,
    /// The email, when the connection may read it.
    pub email: Option<String>,
}

/// A page's body as Notion-flavoured markdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageMarkdown {
    /// The markdown.
    pub markdown: String,
    /// Subtrees Notion left out of `markdown` because the page was too large;
    /// each can be fetched as markdown on its own.
    pub unknown_block_ids: Vec<NotionId>,
}

/// One page of a paginated list.
#[derive(Debug, Clone, PartialEq)]
pub struct Paged<T> {
    /// The items on this page.
    pub results: Vec<T>,
    /// Where the next page starts, when there is one.
    pub next_cursor: Option<String>,
}

/// What a search result is.
#[derive(Debug, Clone, PartialEq)]
pub enum SearchHit {
    /// A page (a document or a row).
    Page(NotionPage),
    /// A data source.
    DataSource(NotionDataSource),
}

/// Which object type a search lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchObject {
    /// Pages, including data source rows.
    Page,
    /// Data sources.
    DataSource,
}

/// What part of the workspace an import covers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ImportScope {
    /// Everything the connection was granted.
    Everything,
    /// These pages and databases, and everything under them.
    Roots {
        /// Page, database or data source ids.
        ids: Vec<NotionId>,
    },
}

/// A data source with what an import plan needs to know about its rows.
#[derive(Debug, Clone, PartialEq)]
pub struct DataSourceSummary {
    /// The data source.
    pub source: NotionDataSource,
    /// Every row the data source holds.
    pub row_count: usize,
    /// The titles of the first few rows.
    pub sample_titles: Vec<String>,
}

/// Everything in scope: the pages that are documents (rows excluded) and the
/// data sources.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Inventory {
    /// Standalone pages; rows of data sources are not here.
    pub pages: Vec<NotionPage>,
    /// Data sources with row summaries.
    pub data_sources: Vec<DataSourceSummary>,
}

/// How far an inventory has got, for progress reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InventoryProgress {
    /// Pages found so far.
    pub pages: usize,
    /// Data sources found so far.
    pub data_sources: usize,
}

#[cfg(test)]
mod test;
