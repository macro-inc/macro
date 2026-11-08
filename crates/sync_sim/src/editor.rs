//! Abstract editor inputs resolved against the live document session at execution time.
use serde::{Deserialize, Serialize};
/// A text-bearing block and UTF-16 offset, resolved modulo current content.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Pos {
    /// Block in document order.
    pub block: u16,
    /// UTF-16 offset, backed off a surrogate-pair interior.
    pub offset: u16,
}
/// Editor inputs use the real session and collaborative history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum EditorOp {
    /// Insert literal text without shortcuts.
    Type {
        /// Current insertion point.
        at: Pos,
        /// Literal text including astral and combining characters.
        text: String,
    },
    /// Delete preceding characters through real model segmentation.
    Backspace {
        /// Current insertion point.
        at: Pos,
        /// Number of consecutive deletion commands.
        count: u8,
    },
    /// Delete the selected range.
    DeleteRange {
        /// Anchor.
        from: Pos,
        /// Focus.
        to: Pos,
    },
    /// Split the selected block through the paragraph command.
    SplitBlock {
        /// Split position.
        at: Pos,
    },
    /// Toggle a format over the selected range.
    Format {
        /// Anchor.
        from: Pos,
        /// Focus.
        to: Pos,
        /// Bold, italic, code or strikethrough modulo four.
        format: u8,
    },
    /// Indent the selected block.
    Indent {
        /// Selected block.
        at: Pos,
    },
    /// Outdent the selected block.
    Outdent {
        /// Selected block.
        at: Pos,
    },
    /// Convert the current block with the rich-node package operation.
    SetBlock {
        /// Selected block.
        at: Pos,
        /// Paragraph, heading1–3, quote or code modulo six.
        kind: u8,
    },
    /// Insert an ordered, unordered or check list through package commands.
    ToggleList {
        /// Selected block.
        at: Pos,
        /// List kind modulo three.
        kind: u8,
    },
    /// Insert a bounded table through the real table operation.
    InsertTable {
        /// Insertion point.
        at: Pos,
        /// One to four rows after resolution.
        rows: u8,
        /// One to four columns after resolution.
        cols: u8,
    },
    /// Paste one fixed source Markdown snippet through the package importer.
    PasteMarkdown {
        /// Current insertion point.
        at: Pos,
        /// Corpus index modulo four; index three is the large input.
        snippet: u8,
    },
    /// Publish actual durable editor selection cursors.
    Select {
        /// Anchor.
        from: Pos,
        /// Focus.
        to: Pos,
    },
    /// Collaborative undo.
    Undo,
    /// Collaborative redo.
    Redo,
}

/// Shared committed corpus; the TS peer imports these same files.
pub fn markdown_snippet(index: u8) -> &'static str {
    static SHORT: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("../fixtures/markdown-snippets.json"))
            .expect("committed Markdown corpus")
    });
    SHORT
        .get(usize::from(index) % (SHORT.len() + 1))
        .map_or(include_str!("../fixtures/large-paste.md"), String::as_str)
}
