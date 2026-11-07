//! Caret-addressed mutations.
use super::*;
/// Empty-text policy when removing a caret range.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SliceMode {
    /// Remove wholly selected text nodes.
    RemoveEmptySlices,
    /// Keep the first empty text boundary for subsequent insertion.
    PreserveEmptyTextSliceCaret,
}
/// Which empty side an element split would create.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SplitEdge {
    /// Empty left side.
    First,
    /// Empty right side.
    Last,
}
/// Hooks and boundaries for a single nonrecursive split.
#[derive(Clone, Copy)]
pub struct SplitAtPointCaretNextOptions {
    /// Copies an element without its children.
    pub copy_element: fn(&mut Transaction<'_>, NodeKey) -> Result<NodeKey, Error>,
    /// Splits an interior text position.
    pub split_text_point_caret:
        fn(&mut Transaction<'_>, TextPointCaret) -> Result<NodeCaret, Error>,
    /// Boundary at which splitting stops.
    pub root_mode: RootMode,
    /// Whether to create an empty side when the element allows it.
    pub should_split: fn(StateRef<'_>, NodeKey, SplitEdge) -> bool,
    /// Remove an empty destination rather than duplicating it.
    pub remove_empty_destination: bool,
}
impl Default for SplitAtPointCaretNextOptions {
    fn default() -> Self {
        Self {
            copy_element: |tx, key| tx.copy_node(key, false),
            split_text_point_caret: |tx, caret| tx.split_text_point_caret(caret),
            root_mode: RootMode::ShadowRoot,
            should_split: |_, _, _| true,
            remove_empty_destination: false,
        }
    }
}
impl Transaction<'_> {
    /// Remove the node adjacent to a caret, retaining its origin.
    pub fn caret_remove(&mut self, caret: PointCaret) -> Result<PointCaret, Error> {
        if let Some(key) = caret.node_at_caret(self.view()) {
            self.remove(key, false)?;
        }
        Ok(caret)
    }
    /// Insert immediately at a directional caret.
    pub fn caret_insert(&mut self, caret: PointCaret, node: NodeKey) -> Result<PointCaret, Error> {
        match caret {
            PointCaret::Child(c) => {
                let index = if c.direction == CaretDirection::Next {
                    0
                } else {
                    self.children_size(c.origin)
                };
                self.splice(c.origin, ChildIndex(index), 0, &[node])?;
            }
            _ if caret.direction() == CaretDirection::Next => {
                self.insert_after(caret.origin(), node, true)?;
            }
            _ => {
                self.insert_before(caret.origin(), node, true)?;
            }
        }
        Ok(caret)
    }
    /// Replace the adjacent node, or insert if no node is there.
    pub fn caret_replace_or_insert(
        &mut self,
        caret: PointCaret,
        node: NodeKey,
        include_children: bool,
    ) -> Result<PointCaret, Error> {
        let target = caret.node_at_caret(self.view());
        if node != caret.origin() && Some(node) != target {
            if let Some(target) = target {
                self.replace(target, node, include_children)?;
            } else {
                self.caret_insert(caret, node)?;
            }
        }
        Ok(caret)
    }
    /// Directional splice, preserving overlaps between inserted and deleted nodes.
    pub fn caret_splice(
        &mut self,
        caret: PointCaret,
        delete_count: u32,
        nodes: &[NodeKey],
        nodes_direction: CaretDirection,
    ) -> Result<PointCaret, Error> {
        let mut remove = crate::collections::IndexSet::default();
        let mut next = caret.adjacent_caret(self.view());
        while let Some(c) = next {
            if remove.len() >= delete_count as usize {
                break;
            }
            self.mark_dirty(c.origin)?;
            remove.insert(c.origin);
            next = PointCaret::from(c).adjacent_caret(self.view());
        }
        let mut insert = nodes.to_vec();
        if nodes_direction != caret.direction() {
            insert.reverse();
        }
        let parent = caret.parent_at_caret(self.view());
        let mut current = caret;
        for node in insert {
            if !remove.is_empty() {
                let target = current
                    .node_at_caret(self.view())
                    .ok_or(Error::CaretSpliceUnderflow)?;
                remove.shift_remove(&target);
                remove.shift_remove(&node);
                if node != target && node != current.origin() {
                    if self.parent(node).is_some() && self.parent(node) == parent {
                        self.remove(node, false)?;
                    }
                    self.replace(target, node, false)?;
                }
            } else {
                self.caret_insert(current, node)?;
            }
            current = SiblingCaret::new(node, caret.direction()).into();
        }
        for node in remove {
            self.remove(node, false)?;
        }
        Ok(caret)
    }
    /// Remove only the text slice, without token or segmented-mode policy.
    pub fn remove_text_slice(
        &mut self,
        slice: TextPointCaretSlice,
    ) -> Result<TextPointCaret, Error> {
        let range = slice.slice_indices();
        let buffer = &self.view().text_data(slice.caret.origin)?.text;
        let start = buffer.byte_offset(range.start)?;
        let end = buffer.byte_offset(range.end)?;
        let text = format!(
            "{}{}",
            buffer
                .as_str()
                .get(..start)
                .ok_or(Error::Invariant("slice start"))?,
            buffer
                .as_str()
                .get(end..)
                .ok_or(Error::Invariant("slice end"))?
        );
        self.text(slice.caret.origin)?.set_text_content(&text)?;
        Ok(TextPointCaret {
            offset: range.start,
            ..slice.caret
        })
    }
    /// Split text at an interior position, returning the corresponding node boundary.
    pub fn split_text_point_caret(&mut self, caret: TextPointCaret) -> Result<NodeCaret, Error> {
        let boundary = text_node_offset(
            self.view(),
            caret.origin,
            direction_spec(caret.direction),
            OffsetMode::Error,
        )?;
        if caret.offset == boundary {
            return Ok(SiblingCaret::new(caret.origin, caret.direction).into());
        }
        if caret.offset
            == text_node_offset(
                self.view(),
                caret.origin,
                direction_spec(caret.direction.flip()),
                OffsetMode::Error,
            )?
        {
            return SiblingCaret::new(caret.origin, caret.direction).rewind(self.view());
        }
        let parts = self.text(caret.origin)?.split_text(&[caret.offset])?;
        let first = *parts.first().ok_or(Error::Invariant("empty text split"))?;
        let point = PointCaret::from(SiblingCaret::new(first, CaretDirection::Next))
            .in_direction(self.view(), caret.direction);
        Ok(match point {
            PointCaret::Child(c) => c.into(),
            other => other.sibling_caret().into(),
        })
    }
    /// Split at most one text node or containing element, respecting configured edges.
    pub fn split_at_point_caret_next(
        &mut self,
        caret: PointCaret,
        options: SplitAtPointCaretNextOptions,
    ) -> Result<Option<NodeCaret>, Error> {
        if caret.direction() != CaretDirection::Next {
            return Err(Error::CaretDirectionMismatch);
        }
        if let PointCaret::Text(c) = caret {
            return (options.split_text_point_caret)(self, c).map(Some);
        }
        let Some(parent_caret) = caret.parent_caret(self.view(), options.root_mode) else {
            return Ok(None);
        };
        let origin = parent_caret.origin;
        if matches!(caret, PointCaret::Child(_)) {
            let before = parent_caret.rewind(self.view())?;
            if options.remove_empty_destination && self.is_empty(origin) {
                self.remove(origin, false)?;
                return Ok(Some(before));
            }
            if !(self.can_be_empty(origin)
                && (options.should_split)(self.view(), origin, SplitEdge::First))
            {
                return Ok(Some(before));
            }
        }
        let node_caret: NodeCaret = match caret {
            PointCaret::Child(c) => c.into(),
            _ => caret.sibling_caret().into(),
        };
        let siblings = node_caret.adjacent_nodes(self.view());
        if !siblings.is_empty()
            || (!options.remove_empty_destination
                && self.can_be_empty(origin)
                && (options.should_split)(self.view(), origin, SplitEdge::Last))
        {
            let copy = (options.copy_element)(self, origin)?;
            self.splice(copy, ChildIndex(0), 0, &siblings)?;
            self.caret_insert(parent_caret.into(), copy)?;
        }
        Ok(Some(parent_caret.into()))
    }
    /// Remove selected text and complete nodes, then merge distinct selected blocks.
    /// s2: CARET-13
    pub fn remove_text_from_caret_range(
        &mut self,
        initial: CaretRange,
        mut mode: SliceMode,
    ) -> Result<CaretRange, Error> {
        if initial.is_collapsed() {
            return Ok(initial);
        }
        let range = initial.in_direction(self.view(), CaretDirection::Next);
        let mut anchors = anchor_positions(self.view(), range.anchor)?;
        let mut focuses = anchor_positions(self.view(), range.focus.flipped(self.view()))?;
        let mut seen = crate::collections::IndexSet::default();
        let mut remove = vec![];
        let mut cursor = range.node_carets(self.view(), RootMode::Root)?;
        while let Some(caret) = cursor.next(self.view())? {
            match caret {
                NodeCaret::Child(c) => {
                    seen.insert(c.origin);
                }
                NodeCaret::Sibling(c) if !self.is_element(c.origin) || seen.contains(&c.origin) => {
                    remove.push(c.origin)
                }
                _ => {}
            }
        }
        for node in remove {
            self.remove(node, false)?;
        }
        let slices = range.text_slices(self.view())?;
        for slice in [slices.0, slices.1].into_iter().flatten() {
            let origin = slice.caret.origin;
            let text_mode = self.view().text_data(origin)?.mode;
            let before = SiblingCaret::new(origin, CaretDirection::Next).rewind(self.view())?;
            if (slice.text_content_size() == u64::from(self.text_content_size(origin).0)
                && mode == SliceMode::RemoveEmptySlices)
                || (text_mode == TextMode::Token && slice.distance != 0)
            {
                self.caret_remove(before.into())?;
            } else if slice.distance != 0 {
                mode = SliceMode::RemoveEmptySlices;
                let mut next = self.remove_text_slice(slice)?;
                if text_mode == TextMode::Segmented {
                    let data = self.view().text_data(origin)?.clone();
                    let plain = self.create_text(data.text.as_str())?.key();
                    self.text(plain)?
                        .set_format(data.format)?
                        .set_style(&data.style)?;
                    self.caret_replace_or_insert(before.into(), plain, false)?;
                    next.origin = plain;
                }
                if anchors.first().is_some_and(|c| c.origin() == origin)
                    && let Some(first) = anchors.first_mut()
                {
                    *first = next.into();
                }
                if focuses.first().is_some_and(|c| c.origin() == origin)
                    && let Some(first) = focuses.first_mut()
                {
                    *first = next.flipped().into();
                }
            }
        }
        let anchor = anchors
            .iter()
            .find(|c| self.is_attached(c.origin()))
            .copied()
            .map(|c| normalize_caret(self.view(), c))
            .transpose()?;
        let focus = focuses
            .iter()
            .find(|c| self.is_attached(c.origin()))
            .copied()
            .map(|c| normalize_caret(self.view(), c))
            .transpose()?;
        if let Some((left, right)) = merge_blocks(self.view(), anchor, focus, &seen) {
            let children = self.children_keys(right)?;
            self.caret_splice(
                ChildCaret {
                    origin: left,
                    direction: CaretDirection::Previous,
                }
                .into(),
                0,
                &children,
                CaretDirection::Next,
            )?;
            let mut parent = self.parent(right);
            self.remove(right, true)?;
            while let Some(key) = parent {
                if key == NodeKey::ROOT || !self.is_empty(key) {
                    break;
                }
                parent = self.parent(key);
                self.remove(key, true)?;
            }
        }
        let best = anchor
            .into_iter()
            .chain(focus)
            .chain(anchors)
            .chain(focuses)
            .find(|c| self.is_attached(c.origin()))
            .ok_or(Error::RemoveTextSelectionLost)?;
        Ok(CaretRange::collapsed(
            normalize_caret(self.view(), best)?.in_direction(self.view(), initial.direction),
        ))
    }
}
fn anchor_positions(view: StateRef<'_>, anchor: PointCaret) -> Result<Vec<PointCaret>, Error> {
    let mut result = vec![anchor];
    let mut parent = if matches!(anchor, PointCaret::Child(_)) {
        anchor.parent_caret(view, RootMode::Root)
    } else {
        Some(anchor.sibling_caret())
    };
    while let Some(caret) = parent {
        result.push(caret.rewind(view)?.into());
        parent = PointCaret::from(caret).parent_caret(view, RootMode::Root);
    }
    Ok(result)
}
fn merge_blocks(
    view: StateRef<'_>,
    anchor: Option<PointCaret>,
    focus: Option<PointCaret>,
    seen: &crate::collections::IndexSet<NodeKey>,
) -> Option<(NodeKey, NodeKey)> {
    let parents = |caret: PointCaret| -> Option<Vec<NodeKey>> {
        let parent = caret.parent_at_caret(view)?;
        let mut nodes: Vec<_> = view.ancestors(parent).collect();
        nodes.reverse();
        nodes.push(parent);
        Some(nodes)
    };
    let left = parents(anchor?)?;
    let right = parents(focus?)?;
    let common = left.iter().zip(&right).take_while(|(a, b)| a == b).count();
    let find = |nodes: &[NodeKey], require_seen: bool| {
        let tail = nodes.get(common..)?;
        if tail.iter().any(|key| view.is_root_or_shadow_root(*key)) {
            return None;
        }
        tail.iter()
            .copied()
            .find(|key| view.is_block(*key) && (!require_seen || seen.contains(key)))
    };
    Some((find(&left, false)?, find(&right, true)?))
}
