//! Directional, mutation-tolerant tree positions (upstream LexicalCaret).
use crate::*;
mod cursor;
mod edit;
mod utils;
pub use cursor::*;
pub use edit::*;
use std::cmp::Ordering;
pub use utils::*;

/// Traversal direction.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::Display)]
#[strum(serialize_all = "lowercase")]
pub enum CaretDirection {
    /// Towards following nodes.
    Next,
    /// Towards preceding nodes.
    Previous,
}
impl CaretDirection {
    /// Reverse direction.
    pub fn flip(self) -> Self {
        match self {
            Self::Next => Self::Previous,
            Self::Previous => Self::Next,
        }
    }
}
/// Traversal boundary.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum RootMode {
    /// Stop at the document root.
    #[default]
    Root,
    /// Also stop at shadow roots.
    ShadowRoot,
}
impl RootMode {
    pub(crate) fn stops(self, view: StateRef<'_>, key: NodeKey) -> bool {
        key == NodeKey::ROOT || (self == Self::ShadowRoot && view.is_shadow_root(key))
    }
}
/// Position kind.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CaretType {
    /// After an origin in its direction.
    Sibling,
    /// Inside an element at its directional start.
    Child,
    /// Within text.
    Text,
}
/// A position outside a node.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct SiblingCaret {
    /// Origin key.
    pub origin: NodeKey,
    /// Traversal direction.
    pub direction: CaretDirection,
}
impl SiblingCaret {
    /// Construct an outside position.
    pub fn new(origin: NodeKey, direction: CaretDirection) -> Self {
        Self { origin, direction }
    }
    /// Position pointing towards this origin.
    pub fn rewind(self, view: StateRef<'_>) -> Result<NodeCaret, Error> {
        let opposite = Self::new(self.origin, self.direction.flip());
        Ok(match PointCaret::from(opposite).node_at_caret(view) {
            Some(origin) => Self::new(origin, self.direction).into(),
            None => ChildCaret {
                origin: view.parent_or_err(self.origin)?,
                direction: self.direction,
            }
            .into(),
        })
    }
}
/// A position inside an element.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ChildCaret {
    /// Element origin.
    pub origin: NodeKey,
    /// Traversal direction.
    pub direction: CaretDirection,
}
impl ChildCaret {
    /// Construct only for an element.
    pub fn new(view: StateRef<'_>, origin: NodeKey, direction: CaretDirection) -> Option<Self> {
        view.is_element(origin)
            .then_some(Self { origin, direction })
    }
}
/// A text position in UTF-16 units.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct TextPointCaret {
    /// Text origin.
    pub origin: NodeKey,
    /// Position in the origin.
    pub offset: Utf16Offset,
    /// Traversal direction.
    pub direction: CaretDirection,
}
/// Requested text offset.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TextOffsetSpec {
    /// Explicit position.
    At(Utf16Offset),
    /// Start of text.
    Start,
    /// End of text.
    End,
}
/// Out-of-range offset policy.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OffsetMode {
    /// Reject offsets beyond text.
    Error,
    /// Clamp to text length.
    Clamp,
}
/// Resolve a caret offset, checking scalar boundaries as well as bounds.
/// s2: CARET-04
pub fn text_node_offset(
    view: StateRef<'_>,
    origin: NodeKey,
    spec: TextOffsetSpec,
    mode: OffsetMode,
) -> Result<Utf16Offset, Error> {
    let text = &view.text_data(origin)?.text;
    let offset = match spec {
        TextOffsetSpec::Start => Utf16Offset::ZERO,
        TextOffsetSpec::End => text.utf16_len(),
        TextOffsetSpec::At(offset) => offset,
    };
    let offset = if mode == OffsetMode::Clamp {
        offset.min(text.utf16_len())
    } else {
        offset
    };
    if offset > text.utf16_len() {
        return Err(Error::InvalidTextOffset {
            offset,
            size: text.utf16_len(),
            key: origin,
        });
    }
    text.byte_offset(offset)?;
    Ok(offset)
}
impl TextPointCaret {
    /// Construct a checked text caret.
    pub fn new(
        view: StateRef<'_>,
        origin: NodeKey,
        direction: CaretDirection,
        spec: TextOffsetSpec,
    ) -> Result<Self, Error> {
        Ok(Self {
            origin,
            direction,
            offset: text_node_offset(view, origin, spec, OffsetMode::Error)?,
        })
    }
    /// Reverse a text caret without moving its offset.
    pub fn flipped(self) -> Self {
        Self {
            direction: self.direction.flip(),
            ..self
        }
    }
    /// Whether movement can stay within this text node.
    pub fn is_extendable(self, view: StateRef<'_>) -> Result<bool, Error> {
        Ok(self.offset
            != text_node_offset(
                view,
                self.origin,
                direction_spec(self.direction),
                OffsetMode::Error,
            )?)
    }
}
pub(crate) fn direction_spec(direction: CaretDirection) -> TextOffsetSpec {
    if direction == CaretDirection::Next {
        TextOffsetSpec::End
    } else {
        TextOffsetSpec::Start
    }
}
/// A whole-node traversal position.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NodeCaret {
    /// Outside position.
    Sibling(SiblingCaret),
    /// Inside position.
    Child(ChildCaret),
}
/// A node or text traversal position.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PointCaret {
    /// Outside position.
    Sibling(SiblingCaret),
    /// Inside position.
    Child(ChildCaret),
    /// Text position.
    Text(TextPointCaret),
}
impl From<SiblingCaret> for NodeCaret {
    fn from(caret: SiblingCaret) -> Self {
        Self::Sibling(caret)
    }
}
impl From<ChildCaret> for NodeCaret {
    fn from(caret: ChildCaret) -> Self {
        Self::Child(caret)
    }
}
impl From<SiblingCaret> for PointCaret {
    fn from(caret: SiblingCaret) -> Self {
        Self::Sibling(caret)
    }
}
impl From<ChildCaret> for PointCaret {
    fn from(caret: ChildCaret) -> Self {
        Self::Child(caret)
    }
}
impl From<TextPointCaret> for PointCaret {
    fn from(caret: TextPointCaret) -> Self {
        Self::Text(caret)
    }
}
impl From<NodeCaret> for PointCaret {
    fn from(caret: NodeCaret) -> Self {
        match caret {
            NodeCaret::Sibling(caret) => Self::Sibling(caret),
            NodeCaret::Child(caret) => Self::Child(caret),
        }
    }
}
impl PointCaret {
    /// Origin identity.
    pub fn origin(self) -> NodeKey {
        match self {
            Self::Sibling(c) => c.origin,
            Self::Child(c) => c.origin,
            Self::Text(c) => c.origin,
        }
    }
    /// Traversal direction.
    pub fn direction(self) -> CaretDirection {
        match self {
            Self::Sibling(c) => c.direction,
            Self::Child(c) => c.direction,
            Self::Text(c) => c.direction,
        }
    }
    /// Position kind.
    pub fn caret_type(self) -> CaretType {
        match self {
            Self::Sibling(_) => CaretType::Sibling,
            Self::Child(_) => CaretType::Child,
            Self::Text(_) => CaretType::Text,
        }
    }
    /// Container at this position.
    pub fn parent_at_caret(self, view: StateRef<'_>) -> Option<NodeKey> {
        if matches!(self, Self::Child(_)) {
            Some(self.origin())
        } else {
            view.parent(self.origin())
        }
    }
    /// Adjacent node; text offsets are intentionally ignored.
    pub fn node_at_caret(self, view: StateRef<'_>) -> Option<NodeKey> {
        match (self.caret_type(), self.direction()) {
            (CaretType::Child, CaretDirection::Next) => view.first_child(self.origin()),
            (CaretType::Child, CaretDirection::Previous) => view.last_child(self.origin()),
            (_, CaretDirection::Next) => view.next_sibling(self.origin()),
            (_, CaretDirection::Previous) => view.prev_sibling(self.origin()),
        }
    }
    /// Outside position on the adjacent node.
    pub fn adjacent_caret(self, view: StateRef<'_>) -> Option<SiblingCaret> {
        Some(SiblingCaret::new(
            self.node_at_caret(view)?,
            self.direction(),
        ))
    }
    /// Outside position on the same origin.
    pub fn sibling_caret(self) -> SiblingCaret {
        SiblingCaret::new(self.origin(), self.direction())
    }
    /// Inside position on the same origin, when possible.
    pub fn child_caret(self, view: StateRef<'_>) -> Option<ChildCaret> {
        ChildCaret::new(view, self.origin(), self.direction())
    }
    /// Descend into the origin when possible.
    pub fn child_caret_or_self(self, view: StateRef<'_>) -> Self {
        self.child_caret(view).map_or(self, Self::Child)
    }
    /// Exit the current container, observing the root boundary.
    pub fn parent_caret(self, view: StateRef<'_>, mode: RootMode) -> Option<SiblingCaret> {
        let parent = self.parent_at_caret(view)?;
        (!mode.stops(view, parent)).then_some(SiblingCaret::new(parent, self.direction()))
    }
    /// Reverse the arrow while preserving its location.
    pub fn flipped(self, view: StateRef<'_>) -> Self {
        if let Self::Text(caret) = self {
            return caret.flipped().into();
        }
        let direction = self.direction().flip();
        if let Some(origin) = self.node_at_caret(view) {
            return SiblingCaret::new(origin, direction).into();
        }
        // A detached sibling has no inverse child position; keep its origin so
        // subsequent checked operations report the absent parent.
        ChildCaret {
            origin: self.parent_at_caret(view).unwrap_or(self.origin()),
            direction,
        }
        .into()
    }
    /// Match position type, origin and direction (text and sibling share node identity).
    pub fn is_same_node_caret(self, other: &Self) -> bool {
        self.origin() == other.origin()
            && self.direction() == other.direction()
            && matches!(
                (self.caret_type(), other.caret_type()),
                (CaretType::Child, CaretType::Child)
                    | (
                        CaretType::Sibling | CaretType::Text,
                        CaretType::Sibling | CaretType::Text
                    )
            )
    }
    /// Match the exact point including the text offset.
    pub fn is_same_point_caret(self, other: &Self) -> bool {
        self == *other
    }
    /// Convert to a requested direction.
    pub fn in_direction(self, view: StateRef<'_>, direction: CaretDirection) -> Self {
        if self.direction() == direction {
            self
        } else {
            self.flipped(view)
        }
    }
}
impl NodeCaret {
    /// Origin identity.
    pub fn origin(self) -> NodeKey {
        PointCaret::from(self).origin()
    }
    /// Traversal direction.
    pub fn direction(self) -> CaretDirection {
        PointCaret::from(self).direction()
    }
    /// Adjacent inside position, or outside position for leaves.
    pub fn adjacent_child_caret(self, view: StateRef<'_>) -> Option<Self> {
        let caret = PointCaret::from(PointCaret::from(self).adjacent_caret(view)?);
        Some(match caret.child_caret(view) {
            Some(c) => c.into(),
            None => caret.sibling_caret().into(),
        })
    }
    /// Adjacent siblings in direction order.
    pub fn adjacent_nodes(self, view: StateRef<'_>) -> Vec<NodeKey> {
        let mut result = vec![];
        let mut next = PointCaret::from(self).adjacent_caret(view);
        while let Some(caret) = next {
            result.push(caret.origin);
            next = PointCaret::from(caret).adjacent_caret(view);
        }
        result
    }
    /// Find an adjacent node, ascending through exhausted parents.
    pub fn adjacent_sibling_or_parent_sibling(
        self,
        view: StateRef<'_>,
        mode: RootMode,
    ) -> Option<(Self, i32)> {
        let mut current = self;
        let mut depth = 0;
        loop {
            if let Some(caret) = current.adjacent_child_caret(view) {
                return Some((caret, depth));
            }
            current = PointCaret::from(current).parent_caret(view, mode)?.into();
            depth -= 1;
        }
    }
}
/// Compare next-directed positions by origins, caret type and text offsets.
/// s2: CARET-14
pub fn compare_point_caret_next(
    view: StateRef<'_>,
    a: PointCaret,
    b: PointCaret,
) -> Result<Ordering, Error> {
    if a.direction() != CaretDirection::Next || b.direction() != CaretDirection::Next {
        return Err(Error::CaretDirectionMismatch);
    }
    Ok(
        match view
            .common_ancestor(a.origin(), b.origin())
            .ok_or(Error::NoCommonAncestor)?
        {
            CommonAncestor::Same { .. } => match (a, b) {
                (PointCaret::Text(a), PointCaret::Text(b)) => a.offset.cmp(&b.offset),
                _ if a.caret_type() == b.caret_type() => Ordering::Equal,
                (PointCaret::Text(_) | PointCaret::Child(_), _) => Ordering::Less,
                _ => Ordering::Greater,
            },
            CommonAncestor::Ancestor { .. } => {
                if matches!(a, PointCaret::Child(_)) {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            }
            CommonAncestor::Descendant { .. } => {
                if matches!(b, PointCaret::Child(_)) {
                    Ordering::Greater
                } else {
                    Ordering::Less
                }
            }
            common @ CommonAncestor::Branch { .. } => common.branch_order(view)?,
        },
    )
}
#[cfg(test)]
mod test;

/// Shared read operations for concrete and node carets.
/// Text offsets are ignored only by node-level navigation, as upstream does.
pub trait Caret: Copy + Into<PointCaret> {
    /// Position kind.
    fn caret_type(self) -> CaretType {
        self.into().caret_type()
    }
    /// Containing element at the position.
    fn parent_at_caret(self, view: StateRef<'_>) -> Option<NodeKey> {
        self.into().parent_at_caret(view)
    }
    /// Adjacent node in the caret direction.
    fn node_at_caret(self, view: StateRef<'_>) -> Option<NodeKey> {
        self.into().node_at_caret(view)
    }
    /// Outside position of the adjacent node.
    fn adjacent_caret(self, view: StateRef<'_>) -> Option<SiblingCaret> {
        self.into().adjacent_caret(view)
    }
    /// Outside position of the same origin.
    fn sibling_caret(self) -> SiblingCaret {
        self.into().sibling_caret()
    }
    /// Inside position when the origin is an element.
    fn child_caret(self, view: StateRef<'_>) -> Option<ChildCaret> {
        self.into().child_caret(view)
    }
    /// Exit the containing element up to the specified boundary.
    fn parent_caret(self, view: StateRef<'_>, mode: RootMode) -> Option<SiblingCaret> {
        self.into().parent_caret(view, mode)
    }
    /// Reverse the position arrow.
    fn flipped(self, view: StateRef<'_>) -> PointCaret {
        self.into().flipped(view)
    }
    /// Compare node position, ignoring a text offset.
    fn is_same_node_caret(self, other: &PointCaret) -> bool {
        self.into().is_same_node_caret(other)
    }
    /// Compare the full position.
    fn is_same_point_caret(self, other: &PointCaret) -> bool {
        self.into().is_same_point_caret(other)
    }
}
impl Caret for SiblingCaret {}
impl Caret for ChildCaret {}
impl Caret for TextPointCaret {}
impl Caret for NodeCaret {}
