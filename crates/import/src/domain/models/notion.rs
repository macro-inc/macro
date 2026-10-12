//! Typed reads of a user's Notion workspace, as discovery and the page
//! converter consume them. The outbound adapter owns the API's JSON shapes.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A Notion object id (page, database, data source, block, or user),
/// normalized to 32 lowercase hex characters without dashes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NotionId(String);

impl NotionId {
    /// Parse a dashed or undashed id. `None` when the input is not one.
    pub fn parse(raw: &str) -> Option<Self> {
        let undashed: String = raw.trim().chars().filter(|c| *c != '-').collect();
        (undashed.len() == 32 && undashed.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| Self(undashed.to_ascii_lowercase()))
    }

    /// The undashed form, which is also the import ledger's foreign id.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The canonical dashed UUID form the API returns.
    pub fn dashed(&self) -> String {
        let s = &self.0;
        format!(
            "{}-{}-{}-{}-{}",
            &s[0..8],
            &s[8..12],
            &s[12..16],
            &s[16..20],
            &s[20..32]
        )
    }

    /// A stable notion.so link for an object the API gave no URL for.
    pub fn web_url(&self) -> String {
        format!("https://www.notion.so/{}", self.0)
    }
}

impl std::fmt::Display for NotionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Where a Notion page, database, or block lives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case", tag = "type", content = "id")]
pub enum NotionParent {
    /// A top-level page in the workspace.
    Workspace,
    /// A child of a page.
    Page(String),
    /// A row of a database. Under API version 2025-09-03 rows name their
    /// data source and, for convenience, its database; the database id is
    /// kept when present since it is what the user sees as a folder.
    Database(String),
    /// A row whose parent named only a data source.
    DataSource(String),
    /// Nested inside a block (a column, toggle, …) of some page.
    Block(String),
    /// A parent shape this importer does not know.
    Unknown,
}

impl NotionParent {
    /// Whether the object is a row of a database.
    pub fn is_database(&self) -> bool {
        matches!(self, Self::Database(_) | Self::DataSource(_))
    }
}

/// One property value read from a database row.
#[derive(Debug, Clone, PartialEq)]
pub enum NotionPropertyValue {
    /// The row's title (it becomes the document name, not a property).
    Title,
    /// Rich text, as plain text.
    RichText(String),
    /// A single select option, when set.
    Select(Option<String>),
    /// A status option, when set.
    Status(Option<String>),
    /// Multi-select option names.
    MultiSelect(Vec<String>),
    /// A date or date range, ISO-8601.
    Date {
        /// Start date or date-time.
        start: String,
        /// End, for ranges.
        end: Option<String>,
    },
    /// A checkbox.
    Checkbox(bool),
    /// A number, when set.
    Number(Option<f64>),
    /// A URL, when set.
    Url(Option<String>),
    /// People, relations, rollups, formulas, files, and anything else the
    /// importer skips.
    Skipped,
}

/// A named database-row property.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionProperty {
    /// Property name.
    pub name: String,
    /// Typed value.
    pub value: NotionPropertyValue,
}

/// A Notion page's metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionPage {
    /// Page id.
    pub id: NotionId,
    /// Link to the page in Notion.
    pub url: String,
    /// Title as plain text (may be empty).
    pub title: String,
    /// The page's emoji icon, when its icon is an emoji.
    pub icon_emoji: Option<String>,
    /// Last edit time.
    pub last_edited_time: DateTime<Utc>,
    /// Who edited last (a Notion user id), when reported.
    pub last_edited_by: Option<String>,
    /// Archived or in the trash.
    pub archived: bool,
    /// Where the page lives.
    pub parent: NotionParent,
    /// Database-row properties (empty for ordinary pages' title-only maps).
    pub properties: Vec<NotionProperty>,
}

/// One page of `POST /v1/search` results.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionSearchPage {
    /// Pages on this result page, in the API's order.
    pub pages: Vec<NotionPage>,
    /// Continuation cursor; `None` on the last page.
    pub next_cursor: Option<String>,
}

/// A database met while walking a page's ancestors (its rows are pages).
#[derive(Debug, Clone, PartialEq)]
pub struct NotionContainer {
    /// Its id.
    pub id: NotionId,
    /// Title as plain text (may be empty).
    pub title: String,
    /// Emoji icon, when its icon is an emoji.
    pub icon_emoji: Option<String>,
    /// Where it lives.
    pub parent: NotionParent,
}

/// Who a Notion connection acts for: `GET /v1/users/me` returns the
/// integration bot, owned by a person or by the whole workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotionOwner {
    /// A person's Notion user id.
    User(String),
    /// The workspace, or an owner shape this importer does not know.
    NotAUser,
}

/// Text formatting flags. Colors are dropped.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NotionAnnotations {
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Strikethrough.
    pub strikethrough: bool,
    /// Underline.
    pub underline: bool,
    /// Inline code.
    pub code: bool,
}

/// An inline mention.
#[derive(Debug, Clone, PartialEq)]
pub enum NotionMention {
    /// A person (rendered `@Name`).
    User {
        /// Their name, when the connection can read it.
        name: Option<String>,
    },
    /// A page.
    Page(NotionId),
    /// A database.
    Database(NotionId),
    /// A date or date range.
    Date {
        /// Start date or date-time.
        start: String,
        /// End, for ranges.
        end: Option<String>,
    },
    /// A link preview.
    LinkPreview(String),
    /// Anything else (rendered as its plain text).
    Other,
}

/// What a rich-text run is.
#[derive(Debug, Clone, PartialEq)]
pub enum NotionRichTextKind {
    /// Plain text, possibly linked.
    Text {
        /// Link target, when the text is a link.
        link: Option<String>,
    },
    /// An inline mention.
    Mention(NotionMention),
    /// An inline KaTeX equation.
    Equation(String),
}

/// One run of rich text.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionRichText {
    /// What the run is.
    pub kind: NotionRichTextKind,
    /// The run's plain text, as Notion renders it.
    pub plain_text: String,
    /// Formatting.
    pub annotations: NotionAnnotations,
}

/// A file attached to a block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionFile {
    /// Download or external URL. Notion-hosted URLs expire after an hour.
    pub url: String,
    /// Whether Notion hosts it (versus an external URL).
    pub hosted: bool,
    /// The file's name, when Notion reports one.
    pub name: Option<String>,
}

/// What a block is.
#[derive(Debug, Clone, PartialEq)]
pub enum NotionBlockKind {
    /// A paragraph.
    Paragraph(Vec<NotionRichText>),
    /// A heading.
    Heading {
        /// 1, 2, or 3.
        level: u8,
        /// Heading text.
        text: Vec<NotionRichText>,
        /// Whether it is a toggle heading (its children hide under it).
        toggleable: bool,
    },
    /// A bulleted list item.
    BulletedListItem(Vec<NotionRichText>),
    /// A numbered list item.
    NumberedListItem(Vec<NotionRichText>),
    /// A to-do.
    ToDo {
        /// Item text.
        text: Vec<NotionRichText>,
        /// Whether it is checked.
        checked: bool,
    },
    /// A toggle.
    Toggle(Vec<NotionRichText>),
    /// A quote.
    Quote(Vec<NotionRichText>),
    /// A callout.
    Callout {
        /// Callout text.
        text: Vec<NotionRichText>,
        /// Emoji icon, when its icon is an emoji.
        icon_emoji: Option<String>,
    },
    /// A code block.
    Code {
        /// The code, as rich text runs.
        text: Vec<NotionRichText>,
        /// Notion's language name.
        language: String,
    },
    /// A divider.
    Divider,
    /// A block equation.
    Equation(String),
    /// A table; its children are rows.
    Table {
        /// Whether the first row is a header.
        has_column_header: bool,
        /// Column count.
        width: usize,
    },
    /// One table row.
    TableRow(Vec<Vec<NotionRichText>>),
    /// A column layout; its children are columns.
    ColumnList,
    /// One column.
    Column,
    /// A synced block. An original has `synced_from = None` and its own
    /// children; a copy names the original, whose children are fetched.
    SyncedBlock {
        /// The original block, for copies.
        synced_from: Option<NotionId>,
    },
    /// An image.
    Image {
        /// The image file.
        file: NotionFile,
        /// Caption.
        caption: Vec<NotionRichText>,
    },
    /// A file, PDF, video, or audio attachment.
    Attachment {
        /// Which of the four it is.
        kind: String,
        /// The file.
        file: NotionFile,
        /// Caption.
        caption: Vec<NotionRichText>,
    },
    /// A bookmark, embed, or link preview.
    Link {
        /// The URL.
        url: String,
        /// Caption, when the block has one.
        caption: Vec<NotionRichText>,
    },
    /// A child page.
    ChildPage {
        /// Its title.
        title: String,
    },
    /// A link to a page.
    LinkToPage(NotionId),
    /// A link to a database.
    LinkToDatabase(NotionId),
    /// An inline (child) database.
    ChildDatabase {
        /// Its title.
        title: String,
    },
    /// Omitted from the import: table of contents, breadcrumb, or a type
    /// the API marks unsupported or this importer does not know.
    Omitted(String),
}

/// A block and, once fetched, its children.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionBlock {
    /// Block id.
    pub id: NotionId,
    /// What it is.
    pub kind: NotionBlockKind,
    /// Whether the API says it has children.
    pub has_children: bool,
    /// Fetched children, in order.
    pub children: Vec<NotionBlock>,
}

/// One page of `GET /v1/blocks/{id}/children`.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionBlockPage {
    /// Blocks on this page, without their children.
    pub blocks: Vec<NotionBlock>,
    /// Continuation cursor; `None` on the last page.
    pub next_cursor: Option<String>,
}
