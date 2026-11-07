//! Selection values shared by node hooks and transactions.
use crate::collections::IndexSet;
use crate::*;
use std::sync::Arc;
/// A typed point in a text node or element.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Point {
    /// Text code-unit position.
    Text {
        /// Text node key.
        key: NodeKey,
        /// UTF-16 position.
        offset: Utf16Offset,
    },
    /// Child boundary.
    Element {
        /// Container key.
        key: NodeKey,
        /// Child position.
        offset: ChildIndex,
    },
}
impl Point {
    /// Construct a text position.
    pub fn text(key: impl Into<NodeKey>, offset: Utf16Offset) -> Self {
        Self::Text {
            key: key.into(),
            offset,
        }
    }
    /// Construct a child boundary.
    pub fn element(key: impl Into<NodeKey>, offset: ChildIndex) -> Self {
        Self::Element {
            key: key.into(),
            offset,
        }
    }
    /// Point node.
    pub fn key(self) -> NodeKey {
        match self {
            Self::Text { key, .. } | Self::Element { key, .. } => key,
        }
    }
    /// Position in the point's units.
    pub fn offset(self) -> u32 {
        match self {
            Self::Text { offset, .. } => offset.0,
            Self::Element { offset, .. } => offset.0,
        }
    }
}
/// Anchor/focus selection and typing attributes.
#[derive(Clone, Debug, PartialEq)]
pub struct RangeSelection {
    /// Anchor position.
    pub anchor: Point,
    /// Focus position.
    pub focus: Point,
    /// Typing format.
    pub format: TextFormat,
    /// Typing CSS.
    pub style: Arc<str>,
}
/// Selected node identities in insertion order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NodeSelection {
    /// Selected keys.
    pub nodes: IndexSet<NodeKey>,
}
/// Rectangular table selection endpoints.
#[derive(Clone, Debug, PartialEq)]
pub struct TableSelection {
    /// Table identity.
    pub table: NodeKey,
    /// First selected cell.
    pub anchor: NodeKey,
    /// Last selected cell.
    pub focus: NodeKey,
    /// Selection changed since commit.
    pub dirty: bool,
}
/// Selection stored in an editor snapshot.
#[derive(Clone, Debug, PartialEq)]
pub enum Selection {
    /// Text or element range.
    Range(RangeSelection),
    /// Explicit nodes.
    Node(NodeSelection),
    /// Table cells.
    Table(TableSelection),
}
/// Identifies the active or a detached selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectionSlot {
    /// Editor selection.
    Active,
    /// Independently edited selection.
    Detached(DetachedSelectionId),
}
/// Transaction-local detached selection handle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DetachedSelectionId(pub(crate) usize);
