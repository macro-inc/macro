//! Selection values shared by node hooks and transactions.
use crate::collections::IndexSet;
use crate::*;
use std::sync::Arc;
mod adjust;
mod format;
mod slot;
mod view;
pub use view::*;
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
#[derive(Clone, Debug)]
pub struct RangeSelection {
    pub(crate) dirty: bool,
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
#[derive(Clone, Debug, Default)]
pub struct NodeSelection {
    /// Selected keys.
    pub(crate) nodes: IndexSet<NodeKey>,
    pub(crate) dirty: bool,
}
/// Rectangular table selection endpoints.
#[derive(Clone, Copy, Debug)]
pub struct TableSelection {
    /// Table identity.
    pub table: NodeKey,
    /// First selected cell.
    pub anchor: Point,
    /// Last selected cell.
    pub focus: Point,
    /// Selection changed since commit.
    pub(crate) dirty: bool,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SelectionSlot {
    /// Editor selection.
    Active,
    /// Independently edited selection.
    Detached(DetachedSelectionId),
}
/// Transaction-local detached selection handle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DetachedSelectionId(pub(crate) usize);

/// The unit represented by a point's offset.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum PointType {
    /// UTF-16 position.
    Text,
    /// Child boundary.
    Element,
}
/// Which endpoint to update.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum PointRole {
    /// Range anchor.
    Anchor,
    /// Range focus.
    Focus,
}
impl Point {
    /// Construct a point from a boundary representation.
    pub fn new(key: impl Into<NodeKey>, offset: u32, point_type: PointType) -> Self {
        match point_type {
            PointType::Text => Self::text(key, Utf16Offset(offset)),
            PointType::Element => Self::element(key, ChildIndex(offset)),
        }
    }
    /// The offset's unit.
    pub fn point_type(self) -> PointType {
        match self {
            Self::Text { .. } => PointType::Text,
            Self::Element { .. } => PointType::Element,
        }
    }
    /// Resolve this point's node.
    pub fn node(self, view: StateRef<'_>) -> Result<NodeKey, Error> {
        view.node(self.key())
            .map(|_| self.key())
            .ok_or(Error::PointNodeNotFound(self.key()))
    }
    /// Compare normalized document boundaries.
    pub fn is_before(self, view: StateRef<'_>, other: &Point) -> Result<bool, Error> {
        self.node(view)?;
        other.node(view)?;
        if self.key() == other.key() {
            return Ok(self.offset() < other.offset());
        }
        let anchor = comparison_point(view, self)?;
        let focus = comparison_point(view, *other)?;
        if anchor.key() == focus.key() {
            return Ok(anchor.offset() < focus.offset());
        }
        view.point_is_before(anchor, focus)
    }
}
// A next-direction child caret uses the preceding sibling as its origin.
// Unlike range normalization, an interior boundary therefore prefers text on
// its left. Only a child caret at offset zero descends through child elements.
fn comparison_point(view: StateRef<'_>, point: Point) -> Result<Point, Error> {
    let Point::Element { mut key, offset } = point else {
        return Ok(point);
    };
    let mut index = offset.0 as usize;
    loop {
        let children = view.children_keys(key)?;
        if index > 0 {
            if let Some(previous) = children.get(index - 1)
                && let Some(text) = view.text(*previous)
            {
                return Ok(Point::text(*previous, text.text.utf16_len()));
            }
        } else if let Some(first) = children.first()
            && view.is_element(*first)
        {
            key = *first;
            index = 0;
            continue;
        }
        if let Some(next) = children.get(index)
            && view.is_text(*next)
        {
            return Ok(Point::text(*next, Utf16Offset::ZERO));
        }
        return Ok(Point::element(key, ChildIndex(index as u32)));
    }
}
impl PartialEq for RangeSelection {
    fn eq(&self, other: &Self) -> bool {
        self.anchor == other.anchor
            && self.focus == other.focus
            && self.format == other.format
            && self.style == other.style
    }
}
impl RangeSelection {
    /// Construct an initially clean range with no typing attributes.
    pub fn new(anchor: Point, focus: Point) -> Self {
        Self {
            anchor,
            focus,
            format: TextFormat::empty(),
            style: Arc::from(""),
            dirty: false,
        }
    }
    /// Construct a range at the start of the root.
    pub fn at_root() -> Self {
        Self::collapsed(Point::element(NodeKey::ROOT, ChildIndex(0)))
    }
    /// Construct a caret.
    pub fn collapsed(point: Point) -> Self {
        Self::new(point, point)
    }
    /// Whether the value has been edited.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }
    /// Whether its endpoints coincide.
    pub fn is_collapsed(&self) -> bool {
        self.anchor == self.focus
    }
    /// Anchor and focus, without sorting.
    pub fn start_end_points(&self) -> (Point, Point) {
        (self.anchor, self.focus)
    }
    /// Whether focus precedes anchor.
    pub fn is_backward(&self, view: StateRef<'_>) -> Result<bool, Error> {
        self.focus.is_before(view, &self.anchor)
    }
    /// Selected nodes in document order.
    pub fn nodes(&self, view: StateRef<'_>) -> Result<Vec<NodeKey>, Error> {
        view.selected_nodes(self)
    }
    /// Selected text, preserving block separators.
    pub fn text_content(&self, view: StateRef<'_>) -> Result<String, Error> {
        view.selection_text_content_for(&Selection::Range(self.clone()))
    }
    /// Prevent forward deletion from crossing a shadow-root boundary.
    pub fn forward_deletion(
        &self,
        view: StateRef<'_>,
        direction: EditDirection,
    ) -> Result<bool, Error> {
        if direction == EditDirection::Backward {
            return Ok(false);
        }
        let key = self.anchor.node(view)?;
        let size = match self.anchor {
            Point::Text { .. } => view.text_content_size(key).get(),
            Point::Element { .. } => view.children_size(key),
        };
        if self.anchor.offset() != size {
            return Ok(false);
        }
        let next = view.next_sibling(key).or_else(|| {
            view.parent(key)
                .and_then(|parent| view.next_sibling(parent))
        });
        Ok(next.is_some_and(|key| view.is_element(key) && view.is_shadow_root(key)))
    }
}
impl PartialEq for NodeSelection {
    fn eq(&self, other: &Self) -> bool {
        self.nodes.len() == other.nodes.len()
            && self.nodes.iter().all(|key| other.nodes.contains(key))
    }
}
impl NodeSelection {
    /// Construct an empty set.
    pub fn new() -> Self {
        Self::default()
    }
    /// Add a key, retaining insertion order.
    pub fn add(&mut self, key: impl Into<NodeKey>) {
        self.nodes.insert(key.into());
        self.dirty = true;
    }
    /// Remove a key.
    pub fn delete(&mut self, key: impl Into<NodeKey>) {
        self.nodes.shift_remove(&key.into());
        self.dirty = true;
    }
    /// Remove all keys.
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.dirty = true;
    }
    /// Test set membership.
    pub fn has(&self, key: impl Into<NodeKey>) -> bool {
        self.nodes.contains(&key.into())
    }
    /// Keys in insertion order.
    pub fn keys(&self) -> impl ExactSizeIterator<Item = NodeKey> + '_ {
        self.nodes.iter().copied()
    }
    /// Existing nodes only.
    pub fn nodes(&self, view: StateRef<'_>) -> Vec<NodeKey> {
        self.keys().filter(|key| view.contains(*key)).collect()
    }
    /// Concatenated text of selected nodes.
    pub fn text_content(&self, view: StateRef<'_>) -> String {
        self.nodes(view)
            .into_iter()
            .map(|key| view.text_content(key))
            .collect()
    }
}
impl PartialEq for TableSelection {
    fn eq(&self, other: &Self) -> bool {
        self.table == other.table && self.anchor == other.anchor && self.focus == other.focus
    }
}
impl TableSelection {
    /// Select between two cells.
    pub fn new(table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey) -> Self {
        Self {
            table,
            anchor: Point::element(anchor_cell, ChildIndex(0)),
            focus: Point::element(focus_cell, ChildIndex(0)),
            dirty: false,
        }
    }
    /// Replace the cell endpoints.
    pub fn set(&mut self, table: NodeKey, anchor_cell: NodeKey, focus_cell: NodeKey) {
        *self = Self::new(table, anchor_cell, focus_cell);
        self.dirty = true;
    }
    /// Whether the value has changed.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }
    /// Validate the cell point kinds and key existence.
    pub fn is_valid(&self, view: StateRef<'_>) -> bool {
        self.table != NodeKey::ROOT
            && [self.anchor, self.focus].into_iter().all(|point| {
                point.key() != NodeKey::ROOT
                    && point.point_type() == PointType::Element
                    && view.contains(point.key())
            })
            && view.contains(self.table)
    }
}
/// Table geometry and editing supplied by the rich-node package.
pub trait TableSelectionHooks: Send + Sync + 'static {
    /// Selected table nodes.
    fn nodes(&self, view: StateRef<'_>, selection: &TableSelection) -> Result<Vec<NodeKey>, Error>;
    /// Selected table text.
    fn text_content(&self, view: StateRef<'_>, selection: &TableSelection)
    -> Result<String, Error>;
    /// Insert content into the selection.
    fn insert_nodes(
        &self,
        tx: &mut Transaction<'_>,
        slot: SelectionSlot,
        nodes: &[NodeKey],
    ) -> Result<(), Error>;
}
impl Selection {
    /// Borrow a range.
    pub fn as_range(&self) -> Option<&RangeSelection> {
        if let Self::Range(range) = self {
            Some(range)
        } else {
            None
        }
    }
    /// Borrow a node set.
    pub fn as_node(&self) -> Option<&NodeSelection> {
        if let Self::Node(nodes) = self {
            Some(nodes)
        } else {
            None
        }
    }
    /// Copy a table selection.
    pub fn as_table(&self) -> Option<TableSelection> {
        if let Self::Table(table) = self {
            Some(*table)
        } else {
            None
        }
    }
    /// Whether this selects a range.
    pub fn is_range(&self) -> bool {
        matches!(self, Self::Range(_))
    }
    /// Whether this selects nodes.
    pub fn is_node(&self) -> bool {
        matches!(self, Self::Node(_))
    }
    /// Whether this selects table cells.
    pub fn is_table(&self) -> bool {
        matches!(self, Self::Table(_))
    }
    /// Whether this is a caret.
    pub fn is_collapsed(&self) -> bool {
        self.as_range().is_some_and(RangeSelection::is_collapsed)
    }
    /// Anchor and focus, when defined.
    pub fn start_end_points(&self) -> Option<(Point, Point)> {
        match self {
            Self::Range(range) => Some(range.start_end_points()),
            Self::Table(table) => Some((table.anchor, table.focus)),
            Self::Node(_) => None,
        }
    }
    /// Whether focus precedes anchor.
    pub fn is_backward(&self, view: StateRef<'_>) -> Result<bool, Error> {
        match self.start_end_points() {
            Some((a, f)) => f.is_before(view, &a),
            None => Ok(false),
        }
    }
    /// Selected node keys.
    pub fn nodes(&self, view: StateRef<'_>) -> Result<Vec<NodeKey>, Error> {
        match self {
            Self::Range(range) => range.nodes(view),
            Self::Node(nodes) => Ok(nodes.nodes(view)),
            Self::Table(table) => view
                .state
                .registry
                .table_selection_hooks
                .as_ref()
                .ok_or(Error::UnsupportedSelection)?
                .nodes(view, table),
        }
    }
    /// Selected text.
    pub fn text_content(&self, view: StateRef<'_>) -> Result<String, Error> {
        view.selection_text_content_for(self)
    }
    /// Whether the selection has been edited.
    pub fn is_dirty(&self) -> bool {
        match self {
            Self::Range(range) => range.dirty,
            Self::Node(nodes) => nodes.dirty,
            Self::Table(table) => table.dirty,
        }
    }
    pub(crate) fn set_dirty(&mut self, dirty: bool) {
        match self {
            Self::Range(range) => range.dirty = dirty,
            Self::Node(nodes) => nodes.dirty = dirty,
            Self::Table(table) => table.dirty = dirty,
        }
    }
}

#[cfg(test)]
mod test;

mod caret;
mod delete;
mod insert;
mod modify;

pub use modify::{Alter, Granularity, ModifyTarget};

mod emoji;
