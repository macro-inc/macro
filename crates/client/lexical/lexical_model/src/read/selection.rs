//! Selection reads using the upstream enter/leave traversal convention.
use super::*;
use crate::collections::IndexSet;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Boundary {
    Child(NodeKey),
    Sibling(NodeKey),
    Text(NodeKey, Utf16Offset),
}
impl Boundary {
    fn key(self) -> NodeKey {
        match self {
            Self::Child(key) | Self::Sibling(key) | Self::Text(key, _) => key,
        }
    }
    fn same_node(self, other: Self) -> bool {
        self.key() == other.key()
            && matches!(
                (self, other),
                (Self::Child(_), Self::Child(_))
                    | (
                        Self::Sibling(_) | Self::Text(..),
                        Self::Sibling(_) | Self::Text(..)
                    )
            )
    }
}
impl<'state> StateRef<'state> {
    fn boundary(self, point: Point) -> Result<Boundary, Error> {
        match point {
            Point::Text { key, offset } => {
                if offset > self.text_data(key)?.text.utf16_len() {
                    return Err(Error::Utf16OffsetOutOfRange(offset));
                }
                Ok(Boundary::Text(key, offset))
            }
            Point::Element { key, offset } => {
                self.element_data(key)?;
                if offset.0 == 0 {
                    Ok(Boundary::Child(key))
                } else {
                    let child = self
                        .child_at_index(key, ChildIndex(offset.0 - 1))
                        .ok_or(Error::SpliceOutOfRange)?;
                    Ok(Boundary::Sibling(child))
                }
            }
        }
    }
    fn boundary_before(self, a: Boundary, b: Boundary) -> Result<bool, Error> {
        if a.key() == b.key() {
            return Ok(match (a, b) {
                (Boundary::Text(_, a), Boundary::Text(_, b)) => a < b,
                (Boundary::Child(_) | Boundary::Text(..), Boundary::Sibling(_)) => true,
                _ => false,
            });
        }
        if self.has_ancestor(b.key(), a.key()) {
            return Ok(matches!(a, Boundary::Child(_)));
        }
        if self.has_ancestor(a.key(), b.key()) {
            return Ok(!matches!(b, Boundary::Child(_)));
        }
        self.is_before(a.key(), b.key())
    }
    pub(crate) fn point_is_before(self, a: Point, b: Point) -> Result<bool, Error> {
        self.boundary_before(self.boundary(a)?, self.boundary(b)?)
    }
    fn next_boundary(self, boundary: Boundary) -> Option<Boundary> {
        let adjacent = match boundary {
            Boundary::Child(key) => self.first_child(key),
            _ => self.next_sibling(boundary.key()),
        };
        if let Some(key) = adjacent {
            return Some(if self.is_element(key) {
                Boundary::Child(key)
            } else {
                Boundary::Sibling(key)
            });
        }
        if let Boundary::Child(key) = boundary {
            return Some(Boundary::Sibling(key));
        }
        let parent = self.parent(boundary.key())?;
        (parent != NodeKey::ROOT).then_some(Boundary::Sibling(parent))
    }
    pub(crate) fn selected_nodes(self, range: &RangeSelection) -> Result<Vec<NodeKey>, Error> {
        let anchor = self.boundary(range.anchor)?;
        let focus = self.boundary(range.focus)?;
        let (start, end) = if self.boundary_before(focus, anchor)? {
            (focus, anchor)
        } else {
            (anchor, focus)
        };
        let mut nodes = Vec::new();
        let mut ancestors = IndexSet::default();
        let mut elements = IndexSet::default();
        if let Boundary::Text(key, _) = start {
            nodes.push(key);
        }
        let mut current = if start.same_node(end) {
            None
        } else {
            self.next_boundary(start)
        };
        while let Some(boundary) = current {
            if matches!(end, Boundary::Text(..)) && boundary.same_node(end) {
                break;
            }
            match boundary {
                Boundary::Child(key) => {
                    if nodes.is_empty() {
                        ancestors.insert(key);
                    } else {
                        elements.insert(key);
                        nodes.push(key);
                    }
                }
                Boundary::Sibling(key) | Boundary::Text(key, _) => {
                    if !self.is_element(key) || !elements.contains(&key) {
                        nodes.push(key);
                    }
                }
            }
            if boundary.same_node(end) {
                break;
            }
            current = self.next_boundary(boundary);
        }
        if let Boundary::Text(key, _) = end
            && !start.same_node(end)
        {
            nodes.push(key);
        }
        if let Boundary::Sibling(key) = end
            && self.is_element(key)
            && self.next_sibling(key).is_none()
        {
            let mut key = Some(key);
            while let Some(element) = key {
                if !ancestors.contains(&element)
                    || self.is_empty(element)
                    || nodes.last() != Some(&element)
                {
                    break;
                }
                ancestors.shift_remove(&element);
                nodes.pop();
                key = self
                    .last_child(element)
                    .filter(|child| self.is_element(*child));
            }
        }
        while nodes.len() > 1 {
            let Some(last) = nodes.last().copied() else {
                break;
            };
            if !self.is_element(last)
                || elements.contains(&last)
                || ancestors.contains(&last)
                || self.is_empty(last)
            {
                break;
            }
            nodes.pop();
        }
        if nodes.is_empty() && range.anchor == range.focus {
            let point = range.anchor;
            let key = match point {
                Point::Text { key, .. } => key,
                Point::Element { key, offset } => {
                    if let Some(child) = self.child_at_index(key, offset) {
                        self.first_descendant(child).unwrap_or(child)
                    } else if let Some(child) = offset
                        .0
                        .checked_sub(1)
                        .and_then(|index| self.child_at_index(key, ChildIndex(index)))
                    {
                        self.last_descendant(child).unwrap_or(child)
                    } else {
                        key
                    }
                }
            };
            nodes.push(key);
        }
        Ok(nodes)
    }
    /// Character offsets of range endpoints, following element-boundary semantics.
    /// Non-range selections have no character endpoints.
    pub fn character_offsets(
        self,
        selection: &Selection,
    ) -> Result<(Utf16Offset, Utf16Offset), Error> {
        let Selection::Range(range) = selection else {
            return Ok((Utf16Offset::ZERO, Utf16Offset::ZERO));
        };
        if matches!(range.anchor, Point::Element { .. }) && range.anchor == range.focus {
            return Ok((Utf16Offset::ZERO, Utf16Offset::ZERO));
        }
        let offset = |point: Point| -> Result<Utf16Offset, Error> {
            Ok(match point {
                Point::Text { key, offset } => {
                    self.text_data(key)?.text.byte_offset(offset)?;
                    offset
                }
                Point::Element { key, offset } => {
                    let size = self.element_data(key)?.children_size();
                    if offset.0 == size {
                        self.text_content_size(key)
                    } else {
                        Utf16Offset::ZERO
                    }
                }
            })
        };
        Ok((offset(range.anchor)?, offset(range.focus)?))
    }
    /// Whether a node belongs to the provided selection, or the active selection.
    pub fn is_selected(self, key: impl Into<NodeKey>, selection: Option<&Selection>) -> bool {
        let key = key.into();
        match selection.or(self.selection()) {
            None => false,
            Some(Selection::Node(selection)) => selection.nodes.contains(&key),
            Some(selection @ Selection::Table(_)) => selection
                .nodes(self)
                .is_ok_and(|nodes| nodes.contains(&key)),
            Some(Selection::Range(range)) => {
                let selected = self
                    .selected_nodes(range)
                    .is_ok_and(|nodes| nodes.contains(&key));
                if self.is_text(key) {
                    return selected;
                }
                if matches!(
                    (range.anchor, range.focus),
                    (Point::Element { .. }, Point::Element { .. })
                ) {
                    if range.anchor == range.focus {
                        return false;
                    }
                    if self.is_decorator(key) && self.is_inline(key) {
                        let first = match self.boundary(range.anchor).and_then(|a| {
                            self.boundary(range.focus)
                                .and_then(|b| self.boundary_before(b, a))
                        }) {
                            Ok(true) => range.focus,
                            _ => range.anchor,
                        };
                        if let Point::Element {
                            key: parent,
                            offset,
                        } = first
                            && self.parent(key) == Some(parent)
                            && self.children_size(parent) == offset.0
                            && self.last_child(parent) == Some(key)
                        {
                            return false;
                        }
                    }
                }
                selected
            }
        }
    }
    /// Plain text of the active selection, empty when no selection is active.
    pub fn selection_text_content(self) -> Result<String, Error> {
        self.selection().map_or_else(
            || Ok(String::new()),
            |selection| self.selection_text_content_for(selection),
        )
    }
    pub(crate) fn selection_text_content_for(self, selection: &Selection) -> Result<String, Error> {
        match selection {
            Selection::Node(selection) => Ok(selection
                .nodes
                .iter()
                .map(|key| self.text_content(*key))
                .collect()),
            Selection::Table(table) => self
                .state
                .registry
                .table_selection_hooks
                .as_ref()
                .ok_or(Error::UnsupportedSelection)?
                .text_content(self, table),
            selection @ Selection::Range(range) => {
                let nodes = self.selected_nodes(range)?;
                let (anchor_offset, focus_offset) = self.character_offsets(selection)?;
                let before = self
                    .boundary_before(self.boundary(range.anchor)?, self.boundary(range.focus)?)?;
                let mut output = String::new();
                let mut previous_element = true;
                for (index, key) in nodes.iter().copied().enumerate() {
                    if self.is_block_element(key) {
                        if !previous_element {
                            output.push('\n');
                        }
                        previous_element = !self.is_empty(key);
                    } else {
                        previous_element = false;
                        if let Some(text) = self.text(key) {
                            let mut start = Utf16Offset::ZERO;
                            let mut end = text.text.utf16_len();
                            if index == 0 {
                                if nodes.len() == 1 {
                                    if !matches!(
                                        (range.anchor, range.focus),
                                        (Point::Element { .. }, Point::Element { .. })
                                    ) || range.anchor.offset() == range.focus.offset()
                                    {
                                        start = anchor_offset.min(focus_offset);
                                        end = anchor_offset.max(focus_offset);
                                    }
                                } else {
                                    start = if before { anchor_offset } else { focus_offset };
                                }
                            } else if index + 1 == nodes.len() {
                                end = if before { focus_offset } else { anchor_offset };
                            }
                            output.push_str(text.text.slice(start..end)?);
                        } else if matches!(
                            self.kind(key),
                            Some(NodeKind::Decorator | NodeKind::LineBreak)
                        ) && (index + 1 != nodes.len() || range.anchor != range.focus)
                        {
                            output.push_str(&self.text_content(key));
                        }
                    }
                }
                Ok(output)
            }
        }
    }
}
