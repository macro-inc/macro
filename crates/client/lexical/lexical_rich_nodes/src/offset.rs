//! Deprecated upstream offset mapping, including its legacy block and parent-link quirks.
use lexical_model::*;
use std::collections::{HashMap, HashSet};
/// Kind of an entry in the offset arena.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OffsetNodeType {
    /// Element, including inline elements.
    Element,
    /// Text-kind leaf, measured in UTF-16 units.
    Text,
    /// Other leaf, measured as one unit.
    Inline,
}
/// Arena index into an offset view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OffsetIdx(usize);
/// One legacy offset entry.
#[derive(Clone, Debug)]
pub struct OffsetNode {
    /// Entry kind.
    pub ty: OffsetNodeType,
    /// Model key.
    pub key: NodeKey,
    /// Inclusive start.
    pub start: Utf16Offset,
    /// Exclusive content end plus any block bump.
    pub end: Utf16Offset,
    /// First child; only that child's parent is linked upstream.
    pub child: Option<OffsetIdx>,
    /// Parent link.
    pub parent: Option<OffsetIdx>,
    /// Previous sibling.
    pub prev: Option<OffsetIdx>,
    /// Next sibling.
    pub next: Option<OffsetIdx>,
}
/// Immutable offset arena for one model snapshot.
#[derive(Clone, Debug)]
pub struct OffsetView {
    nodes: Vec<OffsetNode>,
    map: HashMap<NodeKey, OffsetIdx>,
    first: Option<OffsetIdx>,
    block_offset_size: u32,
}
/// Build a view over root's children with a configurable block separator width.
pub fn create_offset_view(state: &impl Read, block_offset_size: u32) -> Result<OffsetView, Error> {
    let mut view = OffsetView {
        nodes: Vec::new(),
        map: HashMap::new(),
        first: None,
        block_offset_size,
    };
    let (mut offset, mut previous_block) = (0u32, false);
    view.first = view.build_children(
        state,
        &state.children_keys(NodeKey::ROOT)?,
        &mut offset,
        &mut previous_block,
    )?;
    Ok(view)
}
impl OffsetView {
    fn node(&self, index: OffsetIdx) -> Option<&OffsetNode> {
        self.nodes.get(index.0)
    }
    fn node_mut(&mut self, index: OffsetIdx) -> Result<&mut OffsetNode, Error> {
        self.nodes
            .get_mut(index.0)
            .ok_or(Error::Invariant("invalid offset arena index"))
    }
    fn build_children(
        &mut self,
        state: &impl Read,
        children: &[NodeKey],
        offset: &mut u32,
        previous_block: &mut bool,
    ) -> Result<Option<OffsetIdx>, Error> {
        let mut first = None;
        let mut previous = None;
        for key in children {
            state.node_or_err(*key)?;
            let start = *offset;
            let (ty, child) = if state.is_element(*key) {
                let children = state.children_keys(*key)?;
                let child = self.build_children(state, &children, offset, previous_block)?;
                if !*previous_block || children.is_empty() {
                    *previous_block = true;
                    *offset = offset
                        .checked_add(self.block_offset_size)
                        .ok_or(Error::Invariant("offset overflow"))?;
                }
                (OffsetNodeType::Element, child)
            } else {
                *previous_block = false;
                let text = state.is_text(*key);
                *offset = offset
                    .checked_add(if text {
                        state.text_content_size(*key).get()
                    } else {
                        1
                    })
                    .ok_or(Error::Invariant("offset overflow"))?;
                (
                    if text {
                        OffsetNodeType::Text
                    } else {
                        OffsetNodeType::Inline
                    },
                    None,
                )
            };
            let index = OffsetIdx(self.nodes.len());
            self.nodes.push(OffsetNode {
                ty,
                key: *key,
                start: Utf16Offset(start),
                end: Utf16Offset(*offset),
                child,
                parent: None,
                prev: previous,
                next: None,
            });
            if let Some(child) = child {
                self.node_mut(child)?.parent = Some(index);
            }
            if let Some(previous) = previous {
                self.node_mut(previous)?.next = Some(index);
            } else {
                first = Some(index);
            }
            previous = Some(index);
            self.map.insert(*key, index);
        }
        Ok(first)
    }
    fn search(&self, offset: i64) -> Option<OffsetIdx> {
        let mut current = self.first;
        while let Some(index) = current {
            let node = self.node(index)?;
            let end = i64::from(node.end.get())
                + i64::from(node.ty != OffsetNodeType::Element || self.block_offset_size == 0);
            if offset < end {
                if let Some(child) = node.child {
                    current = Some(child);
                    continue;
                }
                return Some(index);
            }
            current = node.next;
        }
        None
    }
    fn adjusted(&self, offset: i64, node: Option<OffsetIdx>, previous: &Self) -> i64 {
        let mut adjusted = offset;
        let mut visited = HashSet::new();
        let mut current = node;
        let delta = |node: &OffsetNode| {
            let size = i64::from(node.end.get()) - i64::from(node.start.get());
            size - previous
                .map
                .get(&node.key)
                .and_then(|index| previous.node(*index))
                .map(|node| i64::from(node.end.get()) - i64::from(node.start.get()))
                .unwrap_or(0)
        };
        while let Some(index) = current {
            let Some(node) = self.node(index) else {
                break;
            };
            visited.insert(node.key);
            adjusted += delta(node);
            if node.prev.is_some() {
                current = node.prev;
                continue;
            }
            let mut parent = node.parent;
            while let Some(index) = parent {
                let Some(node) = self.node(index) else {
                    break;
                };
                // Upstream considers just one preceding sibling at each ancestor.
                if let Some(sibling) = node.prev.and_then(|index| self.node(index)) {
                    visited.insert(sibling.key);
                    adjusted += delta(sibling);
                }
                parent = node.parent;
            }
            break;
        }
        // Keep the old-view visited-parent walk, including its early exit quirk.
        let mut current = previous.search(offset);
        let mut unvisited = false;
        while let Some(index) = current {
            let Some(node) = previous.node(index) else {
                break;
            };
            if !visited.contains(&node.key) {
                unvisited = true;
                break;
            }
            current = node.parent;
        }
        if !unvisited {
            while let Some(index) = current {
                let Some(node) = previous.node(index) else {
                    break;
                };
                if !visited.contains(&node.key) {
                    let old = i64::from(node.end.get()) - i64::from(node.start.get());
                    let new = self
                        .map
                        .get(&node.key)
                        .and_then(|index| self.node(*index))
                        .map(|node| i64::from(node.end.get()) - i64::from(node.start.get()))
                        .unwrap_or(0);
                    adjusted += new - old;
                }
                current = node.prev;
            }
        }
        adjusted
    }
    /// Map absolute offsets to model points, optionally adjusting against an older view.
    pub fn create_selection_from_offsets(
        &self,
        state: &impl Read,
        start: Utf16Offset,
        end: Utf16Offset,
        diff: Option<&Self>,
    ) -> Option<RangeSelection> {
        let (mut start, mut end) = (i64::from(start.get()), i64::from(end.get()));
        if let Some(diff) = diff {
            start = self.adjusted(start, self.search(start), diff);
            end = self.adjusted(end, self.search(end), diff);
        }
        let a = self.node(self.search(start)?)?;
        let f = self.node(self.search(end)?)?;
        let point = |node: &OffsetNode, offset: i64, start_side: bool| -> Option<Point> {
            state.node_or_err(node.key).ok()?;
            match node.ty {
                OffsetNodeType::Text => {
                    let at = u32::try_from(offset - i64::from(node.start.get())).ok()?;
                    if start_side
                        && start != end
                        && at == state.text_content_size(node.key).get()
                        && let Some(next) = state
                            .next_sibling(node.key)
                            .filter(|key| state.is_text(*key))
                    {
                        return Some(Point::text(next, Utf16Offset::ZERO));
                    }
                    Some(Point::text(node.key, Utf16Offset(at)))
                }
                OffsetNodeType::Inline => Some(Point::element(
                    state.parent(node.key)?,
                    ChildIndex(if end > i64::from(node.start.get()) {
                        node.end.get()
                    } else {
                        node.start.get()
                    }),
                )),
                OffsetNodeType::Element => Some(Point::element(node.key, ChildIndex(0))),
            }
        };
        Some(RangeSelection::new(
            point(a, start, true)?,
            point(f, end, false)?,
        ))
    }
    /// Map model points to absolute offsets; unresolved sides return None.
    pub fn get_offsets_from_selection(
        &self,
        state: &impl Read,
        selection: &RangeSelection,
    ) -> (Option<Utf16Offset>, Option<Utf16Offset>) {
        let offset = |point: Point| -> Option<Utf16Offset> {
            match point {
                Point::Text { key, offset } => Some(Utf16Offset(
                    self.node(*self.map.get(&key)?)?
                        .start
                        .get()
                        .checked_add(offset.get())?,
                )),
                Point::Element { key, offset } => {
                    let child = state.descendant_by_index(key, offset)?;
                    let node = self.node(*self.map.get(&child)?)?;
                    Some(if state.index_within_parent(child) != Some(offset) {
                        node.end
                    } else {
                        node.start
                    })
                }
            }
        };
        (offset(selection.anchor), offset(selection.focus))
    }
}
#[cfg(test)]
mod test;
