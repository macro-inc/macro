//! Abstract editor inputs resolved against the live document session at execution time.
use serde::Serialize;
/// A text-bearing block and UTF-16 offset, resolved modulo current content.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Pos {
    /// Block in document order.
    pub block: u16,
    /// UTF-16 offset, backed off a surrogate-pair interior.
    pub offset: u16,
}
/// Editor inputs use the real session and collaborative history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum EditorOp {
    /// Insert literal text without shortcuts.
    Type {
        /// Current insertion point.
        at: Pos,
        /// Literal text including astral and combining characters.
        text: String,
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
