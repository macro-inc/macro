//! Additional structural read helpers.
use super::*;
/// Relationship between two nodes and their nearest common ancestor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommonAncestor {
    /// Both nodes are identical.
    Same {
        /// The shared node.
        ancestor: NodeKey,
    },
    /// The first node contains the second.
    Ancestor {
        /// The first node.
        ancestor: NodeKey,
    },
    /// The second node contains the first.
    Descendant {
        /// The second node.
        ancestor: NodeKey,
    },
    /// The nodes lie on separate branches.
    Branch {
        /// Common container.
        ancestor: NodeKey,
        /// First child branch.
        a: NodeKey,
        /// Second child branch.
        b: NodeKey,
    },
}
impl CommonAncestor {
    /// Shared ancestor identity.
    pub fn ancestor(self) -> NodeKey {
        match self {
            Self::Same { ancestor }
            | Self::Ancestor { ancestor }
            | Self::Descendant { ancestor }
            | Self::Branch { ancestor, .. } => ancestor,
        }
    }
    /// Ordering of separate sibling branches.
    pub fn branch_order(self, view: StateRef<'_>) -> Result<std::cmp::Ordering, Error> {
        match self {
            Self::Branch { a, b, .. } => Ok(if view.is_before(a, b)? {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }),
            _ => Err(Error::Invariant("not separate branches")),
        }
    }
}
impl<'state> StateRef<'state> {
    /// Node or err.
    pub fn node_or_err(self, key: impl Into<NodeKey>) -> Result<NodeRef<'state>, Error> {
        let key = key.into();
        self.node(key).ok_or(Error::NodeNotFound(key))
    }
    /// Contains.
    pub fn contains(self, key: impl Into<NodeKey>) -> bool {
        self.slot(key.into()).is_some()
    }
    /// Type name.
    pub fn type_name(self, key: impl Into<NodeKey>) -> Result<&'static str, Error> {
        Ok(self.node_or_err(key)?.type_name())
    }
    /// Get or err.
    pub fn get_or_err<Node: NodeType>(
        self,
        key: impl Into<NodeKey>,
    ) -> Result<&'state Node, Error> {
        let key = key.into();
        self.node_or_err(key)?;
        self.get::<Node>(key).ok_or(Error::NodeTypeMismatch(key))
    }
    /// Element data.
    pub fn element_data(self, key: impl Into<NodeKey>) -> Result<&'state ElementData, Error> {
        let key = key.into();
        self.element(key).ok_or(Error::NotAnElement(key))
    }
    /// Text data.
    pub fn text_data(self, key: impl Into<NodeKey>) -> Result<&'state TextData, Error> {
        let key = key.into();
        self.text(key).ok_or(Error::NotAText(key))
    }
    /// Find matching parent.
    pub fn find_matching_parent(
        self,
        start: impl Into<NodeKey>,
        mut predicate: impl FnMut(StateRef<'_>, NodeKey) -> bool,
    ) -> Option<NodeKey> {
        let start = start.into();
        std::iter::once(start)
            .chain(self.ancestors(start))
            .find(|key| predicate(self, *key))
    }
    /// Common ancestor.
    pub fn common_ancestor(
        self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Option<CommonAncestor> {
        let a = a.into();
        let b = b.into();
        self.slot(a)?;
        self.slot(b)?;
        if a == b {
            return Some(CommonAncestor::Same { ancestor: a });
        }
        if self.has_ancestor(b, a) {
            return Some(CommonAncestor::Ancestor { ancestor: a });
        }
        if self.has_ancestor(a, b) {
            return Some(CommonAncestor::Descendant { ancestor: b });
        }
        let left: Vec<_> = std::iter::once(a).chain(self.ancestors(a)).collect();
        let right: Vec<_> = std::iter::once(b).chain(self.ancestors(b)).collect();
        for (i, parent) in left.iter().enumerate().skip(1) {
            if let Some(j) = right.iter().position(|key| key == parent) {
                return Some(CommonAncestor::Branch {
                    ancestor: *parent,
                    a: *left.get(i - 1)?,
                    b: *right.get(j.checked_sub(1)?)?,
                });
            }
        }
        None
    }
    /// Common ancestor element.
    pub fn common_ancestor_element(
        self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Option<NodeKey> {
        let mut a = a.into();
        let mut b = b.into();
        if self.kind(a) != Some(NodeKind::Element) {
            a = self.parent(a)?;
        }
        if self.kind(b) != Some(NodeKind::Element) {
            b = self.parent(b)?;
        }
        self.common_ancestor(a, b).map(|common| common.ancestor())
    }
    /// Nodes between.
    pub fn nodes_between(
        self,
        a: impl Into<NodeKey>,
        b: impl Into<NodeKey>,
    ) -> Result<Vec<NodeKey>, Error> {
        let a = a.into();
        let b = b.into();
        self.node_or_err(a)?;
        self.node_or_err(b)?;
        let order: Vec<_> = std::iter::once(NodeKey::ROOT)
            .chain(self.descendants(NodeKey::ROOT).map(|(key, _)| key))
            .collect();
        let start = order
            .iter()
            .position(|key| *key == a)
            .ok_or(Error::NoParent(a))?;
        let end = order
            .iter()
            .position(|key| *key == b)
            .ok_or(Error::NoParent(b))?;
        Ok(order
            .get(start.min(end)..=start.max(end))
            .ok_or(Error::Invariant("document range"))?
            .to_vec())
    }
    /// Adjacent node.
    pub fn adjacent_node(
        self,
        focus: &Point,
        direction: EditDirection,
    ) -> Result<Option<NodeKey>, Error> {
        let mut key = focus.key();
        self.node_or_err(key)?;
        let backward = direction == EditDirection::Backward;
        match focus {
            Point::Element { offset, .. } => {
                let index = if backward {
                    offset.0.checked_sub(1)
                } else {
                    Some(offset.0)
                };
                if let Some(index) = index
                    && let Some(child) = self.child_at_index(key, ChildIndex(index))
                {
                    return Ok(Some(child));
                }
            }
            Point::Text { offset, .. } => {
                if (backward && offset.0 > 0)
                    || (!backward && *offset < self.text_content_size(key))
                {
                    return Ok(None);
                }
            }
        }
        loop {
            let sibling = if backward {
                self.prev_sibling(key)
            } else {
                self.next_sibling(key)
            };
            if sibling.is_some() {
                return Ok(sibling);
            }
            let Some(parent) = self.parent(key) else {
                return Ok(None);
            };
            if self.is_root_or_shadow_root(parent) {
                return Ok(None);
            }
            key = parent;
        }
    }
    /// Is block.
    pub fn is_block(self, key: impl Into<NodeKey>) -> bool {
        let key = key.into();
        if self.kind(key) == Some(NodeKind::Decorator) {
            return !self.is_inline(key);
        }
        if !self.is_element(key) || self.is_root_or_shadow_root(key) {
            return false;
        }
        let leaf = self.first_child(key).is_none_or(|child| {
            self.is_line_break(child) || self.is_text(child) || self.is_inline(child)
        });
        !self.is_inline(key) && self.can_be_empty(key) && leaf
    }
    /// Is element.
    pub fn is_element(self, key: impl Into<NodeKey>) -> bool {
        self.kind(key) == Some(NodeKind::Element)
    }
    /// Is text.
    pub fn is_text(self, key: impl Into<NodeKey>) -> bool {
        self.kind(key) == Some(NodeKind::Text)
    }
    /// Is decorator.
    pub fn is_decorator(self, key: impl Into<NodeKey>) -> bool {
        self.kind(key) == Some(NodeKind::Decorator)
    }
    /// Is line break.
    pub fn is_line_break(self, key: impl Into<NodeKey>) -> bool {
        self.kind(key) == Some(NodeKind::LineBreak)
    }
}
