//! Word document commands shared by the AI tools and the editing worker port.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One change to a Word document's body. Ids are the paragraph, table and
/// block ids `ReadWordDocument` reports.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WordDocumentOperation {
    /// Replace text inside one paragraph. The new text takes the formatting of
    /// the text it replaces; everything else in the paragraph is kept.
    ReplaceText {
        /// Paragraph id.
        paragraph: String,
        /// Exact text to find in that paragraph's plain text.
        find: String,
        /// Replacement text, empty to delete. No line breaks; tabs are kept.
        replace: String,
        /// Which match (1-based) when `find` appears more than once.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occurrence: Option<u32>,
    },
    /// Rewrite a paragraph's whole text, keeping its style and the formatting
    /// of its first run.
    SetText {
        /// Paragraph id.
        paragraph: String,
        /// The new text. No line breaks; use insertParagraph for more paragraphs.
        text: String,
    },
    /// Turn character formatting on or off for found text, or the whole
    /// paragraph when `find` is omitted. Omitted properties are unchanged.
    FormatText {
        /// Paragraph id.
        paragraph: String,
        /// Exact text to format; omit for the whole paragraph.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        find: Option<String>,
        /// Which match (1-based) when `find` appears more than once.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        occurrence: Option<u32>,
        /// Bold.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bold: Option<bool>,
        /// Italic.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        italic: Option<bool>,
        /// Single underline.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        underline: Option<bool>,
        /// Strikethrough.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        strikethrough: Option<bool>,
    },
    /// Insert paragraphs next to a paragraph or block; each line of `text`
    /// becomes one paragraph. Inside a table cell they stay in that cell.
    InsertParagraph {
        /// Insert after this paragraph or block id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<String>,
        /// Insert before this paragraph or block id.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        before: Option<String>,
        /// Text; newlines separate paragraphs.
        text: String,
        /// Paragraph style id or name. Omitted: after a heading the style's
        /// next style (usually Normal), otherwise the neighbour's formatting.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<String>,
    },
    /// Delete a paragraph, table or other block.
    Delete {
        /// Paragraph, table or block id.
        id: String,
    },
    /// Apply a paragraph style, such as Heading1, Title, Normal or ListBullet.
    SetStyle {
        /// Paragraph id.
        paragraph: String,
        /// Paragraph style id or name, from the list ReadWordDocument shows.
        style: String,
    },
}

/// A request to the editing worker for a Word document's live copy.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WordDocumentRequest {
    /// Describe the body with paragraph and table ids.
    Read {
        /// First block (1-based) to describe.
        #[serde(skip_serializing_if = "Option::is_none")]
        start: Option<u32>,
        /// Most blocks to describe.
        #[serde(skip_serializing_if = "Option::is_none")]
        count: Option<u32>,
    },
    /// Apply operations atomically and push them to everyone.
    Edit {
        /// Ordered operations applied together.
        operations: Vec<WordDocumentOperation>,
    },
}

/// The worker's answer: the document, or the changed blocks, as text.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WordDocumentResponse {
    /// Blocks with their ids and text, or what an edit changed.
    pub content: String,
}
