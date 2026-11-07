use crate::*;
impl Transaction<'_> {
    /// Insert text at the active selection.
    pub fn insert_text(&mut self, text: &str) -> Result<(), Error> {
        self.insert_text_at(SelectionSlot::Active, text)
    }
    /// Replace selected text, respecting token boundaries and typing attributes.
    pub fn insert_text_at(&mut self, slot: SelectionSlot, text: &str) -> Result<(), Error> {
        if self
            .selection_at(slot)?
            .is_some_and(|selection| !selection.is_range())
        {
            return Ok(());
        }
        let mut original = self.range_at(slot)?.clone();
        let backward = original.is_backward(self.view())?;
        let start = if backward {
            original.focus
        } else {
            original.anchor
        };
        let end = if backward {
            original.anchor
        } else {
            original.focus
        };
        if let Point::Element { key, offset } = start {
            // Upstream transfers an element start to a new empty text before
            // resolving the end boundary. Leaf insertBefore updates element
            // offsets; direct paragraph splices leave them unchanged.
            let text = self.create_text("")?;
            self.text(text)?
                .set_format(original.format)?
                .set_style(&original.style)?;
            let placement = self.child_at_index(key, offset);
            if let Some(paragraph) = placement.filter(|child| self.is::<Paragraph>(*child)) {
                self.splice(paragraph, ChildIndex(0), 0, &[text.key()])?;
            } else if key == NodeKey::ROOT {
                let paragraph = self.create(Paragraph::default())?;
                self.append(paragraph, &[text.key()])?;
                self.splice(key, offset, 0, &[paragraph.key()])?;
            } else {
                if let Some(child) = placement {
                    self.insert_before(child, text, true)?;
                } else {
                    self.splice(key, offset, 0, &[text.key()])?;
                }
            }
            let next = Point::text(text, Utf16Offset::ZERO);
            let shifted = self.range_at(slot)?;
            let end = if start == end {
                next
            } else if placement.is_some_and(|child| self.is::<Paragraph>(child)) {
                end
            } else if backward {
                shifted.anchor
            } else {
                shifted.focus
            };
            if backward {
                original.focus = next;
                original.anchor = end;
            } else {
                original.anchor = next;
                original.focus = end;
            }
            self.install_selection_at(slot, Selection::Range(original.clone()))?;
        }
        let end_role = if backward {
            PointRole::Anchor
        } else {
            PointRole::Focus
        };
        let end_point = if backward {
            original.anchor
        } else {
            original.focus
        };
        if end_point.point_type() == PointType::Element {
            let end_point = super::comparison_point(self.view(), end_point)?;
            if backward {
                original.anchor = end_point;
            } else {
                original.focus = end_point;
            }
            self.set_point_at(slot, end_role, end_point)?;
        }
        let selected = original.nodes(self.view())?;
        if selected.len() == 1
            && (if backward {
                original.anchor
            } else {
                original.focus
            })
            .point_type()
                == PointType::Element
            && let Some(first) = selected.first().copied().filter(|key| self.is_text(*key))
        {
            let end = Point::text(first, self.text_content_size(first));
            if backward {
                original.anchor = end;
            } else {
                original.focus = end;
            }
            self.set_point_at(slot, end_role, end)?;
        }
        if selected.len() > 1
            && selected.iter().all(|key| {
                self.is::<Paragraph>(*key)
                    || self
                        .parent(*key)
                        .is_some_and(|parent| self.is::<Paragraph>(parent))
            })
        {
            return self
                .insert_text_across_paragraph_nodes(slot, &original, &selected, text, backward);
        }
        if !original.is_collapsed()
            && let [key] = selected.as_slice()
            && self.is_token_or_tab(*key)
        {
            let replacement = self.create_text(text)?;
            self.replace(*key, replacement, false)?;
            return self.finish_text_insertion(
                slot,
                true,
                Point::text(replacement, TextBuffer::new(text).utf16_len()),
                original.format,
                original.style,
            );
        }
        let first_format = selected
            .first()
            .and_then(|key| self.view().text(*key))
            .map(|data| (data.format, data.style.clone()));
        if !original.is_collapsed() {
            self.remove_range(slot, !text.is_empty())?;
        }
        let range = self.range_at(slot)?.clone();
        let mut point = range.anchor;
        let mut force_selection = false;
        if let Point::Element { key, offset } = point {
            if self.is_root_or_shadow_root(key) {
                let child = self.child_at_index(key, offset);
                if let Some(child) = child.filter(|child| self.is_element(*child)) {
                    point = self.start_point(child)?;
                } else {
                    let p = self.create(Paragraph::default())?;
                    self.splice(key, offset, 0, &[p.key()])?;
                    point = Point::element(p, ChildIndex(0));
                }
            }
            if let Point::Element { key, offset } = point {
                if let Some(child) = self
                    .child_at_index(key, offset)
                    .filter(|child| self.is_text(*child))
                {
                    point = Point::text(child, Utf16Offset::ZERO);
                } else {
                    if text.is_empty() {
                        return Ok(());
                    }
                    let new = self.create_text(text)?;
                    let (format, style) = if original.is_collapsed() {
                        (range.format, range.style.clone())
                    } else {
                        first_format.unwrap_or((range.format, range.style.clone()))
                    };
                    self.text(new)?.set_format(format)?.set_style(&style)?;
                    self.splice(key, offset, 0, &[new.key()])?;
                    return self.finish_text_insertion(
                        slot,
                        true,
                        Point::text(new, TextBuffer::new(text).utf16_len()),
                        format,
                        style,
                    );
                }
            }
        }
        let Point::Text {
            mut key,
            mut offset,
        } = point
        else {
            return Err(Error::NoRangeSelection);
        };
        let data = self.view().text_data(key)?.clone();
        let parent = self.parent_or_err(key)?;
        let at_start = offset == Utf16Offset::ZERO;
        let at_end = offset == data.text.utf16_len();
        let protected = self.is_token_or_segmented(key)
            || (at_start && !self.can_insert_text_before(key))
            || (at_end && !self.can_insert_text_after(key))
            || (at_start
                && self.prev_sibling(key).is_none()
                && !self.can_insert_text_before(parent))
            || (at_end && self.next_sibling(key).is_none() && !self.can_insert_text_after(parent));
        if original.is_collapsed() && protected && (at_start || at_end) {
            force_selection = true;
            let adjacent = if at_start {
                self.prev_sibling(key)
            } else {
                self.next_sibling(key)
            };
            let target = if let Some(adjacent) = adjacent.filter(|key| {
                self.is_text(*key)
                    && !self.is_token_or_segmented(*key)
                    && if at_start {
                        self.can_insert_text_after(*key)
                    } else {
                        self.can_insert_text_before(*key)
                    }
            }) {
                adjacent
            } else {
                let new = self.create_text("")?;
                self.text(new)?
                    .set_format(range.format)?
                    .set_style(&range.style)?;
                let outside = if at_start {
                    !self.can_insert_text_before(parent)
                } else {
                    !self.can_insert_text_after(parent)
                };
                let target = if outside { parent } else { key };
                if at_start {
                    self.insert_before(target, new, false)?;
                } else {
                    self.insert_after(target, new, false)?;
                }
                new.key()
            };
            key = target;
            offset = if at_start {
                self.text_content_size(target)
            } else {
                Utf16Offset::ZERO
            };
        } else if self.is_token_or_tab(key) {
            let replacement = self.create_text(text)?;
            self.replace(key, replacement, false)?;
            return self.finish_text_insertion(
                slot,
                true,
                Point::text(replacement, TextBuffer::new(text).utf16_len()),
                range.format,
                range.style.clone(),
            );
        } else if data.is_segmented() {
            let plain = self.create_text(data.text.as_str())?;
            self.text(plain)?
                .set_format(range.format)?
                .set_style(&range.style)?;
            self.replace(key, plain, false)?;
            key = plain.key();
        }
        let current = self.view().text_data(key)?.clone();
        let (format, style) = if original.is_collapsed() {
            (range.format, range.style.clone())
        } else {
            first_format.unwrap_or((current.format, current.style.clone()))
        };
        if original.is_collapsed()
            && (current.format != format || current.style != style)
            && !current.text.as_str().is_empty()
        {
            if text.is_empty() {
                return Ok(());
            }
            let new = self.create_text(text)?;
            self.text(new)?.set_format(format)?.set_style(&style)?;
            if offset == Utf16Offset::ZERO {
                self.insert_before(key, new, false)?;
            } else {
                if offset < current.text.utf16_len() {
                    self.text(key)?.split_text(&[offset])?;
                }
                self.insert_after(key, new, false)?;
            }
            force_selection = true;
            key = new.key();
            offset = TextBuffer::new(text).utf16_len();
        } else {
            self.text(key)?
                .set_format(format)?
                .set_style(&style)?
                .splice_text(offset..offset, text, false)?;
            offset = offset + TextBuffer::new(text).utf16_len();
        }
        self.finish_text_insertion(
            slot,
            force_selection,
            Point::text(key, offset),
            format,
            style,
        )?;
        if self.composition_key() == Some(key) {
            let anchor = self.anchor_at(slot)?;
            if let Point::Text { key, offset } = anchor {
                self.set_point_at(
                    slot,
                    PointRole::Anchor,
                    Point::text(key, offset - TextBuffer::new(text).utf16_len()),
                )?;
            }
        }
        Ok(())
    }
    fn finish_text_insertion(
        &mut self,
        slot: SelectionSlot,
        force_selection: bool,
        point: Point,
        format: TextFormat,
        style: std::sync::Arc<str>,
    ) -> Result<(), Error> {
        if slot == SelectionSlot::Active {
            return self.collapsed_selection_at(slot, point, format, style);
        }
        self.set_selection_format_at(slot, format)?;
        self.set_selection_style_at(slot, &style)?;
        if force_selection
            || self
                .pending
                .selection
                .as_ref()
                .is_some_and(Selection::is_range)
        {
            self.collapsed_selection_at(SelectionSlot::Active, point, format, style)?;
        }
        Ok(())
    }
    // Upstream insertText still uses its older node-based replacement algorithm,
    // whose element-end semantics differ from caret-range removeText.
    fn insert_text_across_paragraph_nodes(
        &mut self,
        slot: SelectionSlot,
        range: &RangeSelection,
        nodes: &[NodeKey],
        text: &str,
        backward: bool,
    ) -> Result<(), Error> {
        let first = *nodes.first().ok_or(Error::NoRangeSelection)?;
        let mut last = *nodes.last().ok_or(Error::NoRangeSelection)?;
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        let first_data = self.view().text_data(first)?.clone();
        let first_parent = self.parent_or_err(first)?;
        let last_parent = if self.is_element(last) {
            last
        } else {
            self.parent_or_err(last)?
        };
        let last_child = last;
        let mut keep = crate::collections::IndexSet::default();
        keep.extend(self.ancestors(first));
        keep.extend(self.ancestors(last));
        let mutate_last = if end.point_type() == PointType::Text {
            end.offset() != 0 || self.text_content_size(last) == Utf16Offset::ZERO
        } else {
            self.index_within_parent(last)
                .is_some_and(|index| index.0 < end.offset())
        };
        if mutate_last {
            if self.is_text(last)
                && !self.is_token_or_tab(last)
                && end.offset() != self.text_content_size(last).get()
            {
                if self
                    .view()
                    .text(last)
                    .is_some_and(|data| data.is_segmented())
                {
                    let content = self.text_content(last).into_owned();
                    let replacement = self.create_text(&content)?;
                    self.replace(last, replacement, false)?;
                    last = replacement.key();
                }
                if end.point_type() == PointType::Text {
                    self.text(last)?.splice_text(
                        Utf16Offset::ZERO..Utf16Offset(end.offset()),
                        "",
                        false,
                    )?;
                }
                keep.insert(last);
            } else {
                self.remove(last, false)?;
            }
        } else {
            keep.insert(last);
        }
        let selected = nodes
            .iter()
            .copied()
            .collect::<crate::collections::IndexSet<_>>();
        for child in self.children_keys(last_parent)?.into_iter().rev() {
            if child == first || self.has_ancestor(first, child) {
                break;
            }
            if self.is_attached(child) {
                if !selected.contains(&child) || child == last_child {
                    if first_parent != last_parent {
                        self.insert_after(first, child, false)?;
                    }
                } else {
                    self.remove(child, false)?;
                }
            }
        }
        if first_parent != last_parent {
            let mut parent = Some(last_parent);
            let mut removed = None;
            while let Some(key) = parent {
                if self.is_empty(key) || self.last_child(key) == removed {
                    keep.shift_remove(&key);
                    removed = Some(key);
                }
                parent = self.parent(key);
            }
        }
        if !self.is_token_or_tab(first) {
            self.text(first)?.splice_text(
                Utf16Offset(start.offset())..first_data.text.utf16_len(),
                text,
                false,
            )?;
            self.finish_text_insertion(
                slot,
                false,
                Point::text(
                    first,
                    Utf16Offset(start.offset()) + TextBuffer::new(text).utf16_len(),
                ),
                first_data.format,
                first_data.style,
            )?;
            if self.text_content_size(first) == Utf16Offset::ZERO {
                self.remove(first, false)?;
            }
        } else if start.offset() == first_data.text.utf16_len().get() {
            self.select_end(first)?;
        } else {
            let replacement = self.create_text(text)?;
            self.replace(first, replacement, false)?;
            self.finish_text_insertion(
                slot,
                true,
                Point::text(replacement, TextBuffer::new(text).utf16_len()),
                range.format,
                range.style.clone(),
            )?;
        }
        for key in nodes.iter().copied().skip(1) {
            if !keep.contains(&key) {
                self.remove(key, false)?;
            }
        }
        Ok(())
    }
    /// Insert literal tabs and line breaks at the active selection.
    pub fn insert_raw_text(&mut self, text: &str) -> Result<(), Error> {
        self.insert_raw_text_at(SelectionSlot::Active, text)
    }
    /// Insert literal text through node insertion for a slot.
    pub fn insert_raw_text_at(&mut self, slot: SelectionSlot, text: &str) -> Result<(), Error> {
        if self
            .selection_at(slot)?
            .is_some_and(|selection| !selection.is_range())
        {
            return Ok(());
        }
        let nodes = self.nodes_from_raw_text(text)?;
        self.insert_nodes_at(slot, &nodes)
    }
    /// Insert a paragraph at the active range.
    pub fn insert_paragraph(&mut self) -> Result<Option<NodeKey>, Error> {
        self.insert_paragraph_at(SelectionSlot::Active)
    }
    /// Split the containing block through its virtual paragraph hook.
    pub fn insert_paragraph_at(&mut self, slot: SelectionSlot) -> Result<Option<NodeKey>, Error> {
        // Root insertion is a splice at the anchor, even for a noncollapsed range.
        // Upstream checks this before removing the selected block contents.
        let point = self.anchor_at(slot)?;
        if self.is_root_or_shadow_root(point.key()) {
            let p = self.create(Paragraph::default())?;
            self.splice(point.key(), ChildIndex(point.offset()), 0, &[p.key()])?;
            let range = self.range_at(slot)?.clone();
            self.collapsed_selection_at(
                SelectionSlot::Active,
                Point::element(p, ChildIndex(0)),
                range.format,
                range.style,
            )?;
            return Ok(Some(p.key()));
        }
        if !self.range_at(slot)?.is_collapsed() {
            self.remove_text_at(slot)?;
        }
        let slot = if self.anchor_at(slot)?.key() == NodeKey::ROOT {
            // removeText can leave a root caret after the initial root shortcut.
            // Upstream's splitNodeAtPoint fallback appends and selects a paragraph.
            let p = self.create(Paragraph::default())?;
            self.append(NodeKey::ROOT, &[p.key()])?;
            self.select_start(p)?;
            SelectionSlot::Active
        } else {
            slot
        };
        let (block, index) = self.split_selection_boundary(slot)?;
        let tail = self
            .children(block)
            .skip(index.0 as usize)
            .collect::<Vec<_>>();
        let next = self.insert_new_after(block, slot, false)?;
        if let Some(next) = next {
            self.append(next, &tail)?;
            let point = self.start_point(next)?;
            let range = self.range_at(slot)?.clone();
            self.collapsed_selection_at(SelectionSlot::Active, point, range.format, range.style)?;
        }
        Ok(next)
    }
    /// Insert a line-break node at the active range.
    pub fn insert_line_break(&mut self, select_start: bool) -> Result<(), Error> {
        self.insert_line_break_at(SelectionSlot::Active, select_start)
    }
    /// Insert a line break and optionally select before it.
    pub fn insert_line_break_at(
        &mut self,
        slot: SelectionSlot,
        select_start: bool,
    ) -> Result<(), Error> {
        let line = self.create(LineBreak::default())?;
        self.insert_nodes_at(slot, &[line.key()])?;
        if select_start {
            let p = self.parent_or_err(line)?;
            let index = self
                .index_within_parent(line)
                .ok_or(Error::NoParent(line.key()))?;
            self.set_point_at(
                SelectionSlot::Active,
                PointRole::Anchor,
                Point::element(p, index),
            )?;
            self.set_point_at(
                SelectionSlot::Active,
                PointRole::Focus,
                Point::element(p, index),
            )?;
        }
        Ok(())
    }
    /// Insert nodes at the active selection.
    pub fn insert_nodes(&mut self, nodes: &[NodeKey]) -> Result<(), Error> {
        self.insert_nodes_at(SelectionSlot::Active, nodes)
    }
    /// Insert inline runs or blocks through the node's virtual hooks.
    pub fn insert_nodes_at(&mut self, slot: SelectionSlot, nodes: &[NodeKey]) -> Result<(), Error> {
        self.guard_write()?;
        if nodes.is_empty() {
            return Ok(());
        }
        let selection = self
            .selection_at(slot)?
            .cloned()
            .ok_or(Error::NoSelection)?;
        match selection {
            Selection::Table(_) => {
                let hooks = self
                    .pending
                    .registry
                    .table_selection_hooks
                    .clone()
                    .ok_or(Error::UnsupportedSelection)?;
                return hooks.insert_nodes(self, slot, nodes);
            }
            Selection::Node(selection) => {
                let selected = selection.nodes(self.view());
                let Some(last) = selected.last().copied() else {
                    return Ok(());
                };
                let point = if self.is_text(last) {
                    self.end_point(last)?
                } else {
                    Point::element(
                        self.parent_or_err(last)?,
                        ChildIndex(
                            self.index_within_parent(last)
                                .ok_or(Error::NoParent(last))?
                                .0
                                + 1,
                        ),
                    )
                };
                self.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))?;
                self.insert_nodes_at(SelectionSlot::Active, nodes)?;
                for key in selected {
                    if self.is_attached(key) {
                        self.remove(key, false)?;
                    }
                }
                return Ok(());
            }
            Selection::Range(range) => {
                if !range.is_collapsed() {
                    self.remove_text_at(slot)?;
                }
            }
        }
        let slot = if self.is_root_or_shadow_root(self.anchor_at(slot)?.key()) {
            self.insert_paragraph_at(slot)?;
            SelectionSlot::Active
        } else {
            slot
        };
        let first_block = self
            .selection_block(self.anchor_at(slot)?)
            .ok_or(Error::Invariant("insertion requires a block"))?;
        if self.has_language_field(first_block) && self.has_language_field(nodes[0]) {
            let text = self.text_content(nodes[0]).into_owned();
            return self.insert_text_at(slot, &text);
        }
        let (block, index) = self.split_selection_boundary(slot)?;
        let blocks = nodes
            .iter()
            .any(|key| (self.is_element(*key) || self.is_decorator(*key)) && !self.is_inline(*key));
        if self.has_language_field(block) || !blocks {
            self.splice(block, index, 0, nodes)?;
            let last = *nodes
                .last()
                .ok_or(Error::Invariant("empty node insertion"))?;
            let point = if !self.is_text(last) && !self.is_element(last) {
                match self.next_sibling(last).filter(|key| self.is_text(*key)) {
                    Some(next) => Point::text(next, Utf16Offset::ZERO),
                    None => self.end_point(last)?,
                }
            } else {
                self.end_point(last)?
            };
            let range = self.range_at(slot)?.clone();
            return self.collapsed_selection_at(
                SelectionSlot::Active,
                point,
                range.format,
                range.style,
            );
        }
        // Upstream uses a virtual paragraph while grouping inline runs; its key is burned.
        let _virtual_root = self.create(Paragraph::default())?;
        let mut wrapped = Vec::new();
        let mut wrapper = None;
        for key in nodes {
            if (self.is_element(*key) || self.is_decorator(*key))
                && !self.is_inline(*key)
                && !self.is_parent_required(*key)
            {
                wrapper = None;
                wrapped.push(*key);
            } else if let Some(parent) = wrapper {
                self.append(parent, &[*key])?;
            } else {
                let parent = self.create_parent_element(*key)?;
                if !self.is_line_break(*key) {
                    self.append(parent, &[*key])?;
                }
                wrapped.push(parent);
                wrapper = Some(parent);
            }
        }
        let Some(last) = wrapped.last().copied() else {
            return Ok(());
        };
        let select = self.last_descendant(last).unwrap_or(last);
        let trailing = if !self.is_empty(block) {
            self.insert_paragraph_at(slot)?
        } else {
            None
        };
        let mut after = block;
        for (i, key) in wrapped.into_iter().enumerate() {
            if i == 0
                && self.is_element(key)
                && self.is_block(key)
                && !self.is_empty(key)
                && (!self.is_empty(block) || self.can_merge_when_empty(block))
            {
                let children = self.children_keys(key)?;
                self.append(block, &children)?;
            } else {
                self.insert_after(after, key, false)?;
                after = key;
            }
        }
        if let Some(trailing) = trailing
            && self.is_element(after)
            && (self.can_merge_when_empty(trailing) || self.is_block(after))
        {
            let children = self.children_keys(trailing)?;
            self.append(after, &children)?;
            self.remove(trailing, false)?;
        }
        if self.is_empty(block) {
            self.remove(block, false)?;
        }
        if after != block
            && let Some(last) = self.last_child(block)
            && self.is_line_break(last)
        {
            self.remove(last, false)?;
        }
        let point = self.end_point(select)?;
        let range = self.range_at(slot)?.clone();
        self.collapsed_selection_at(SelectionSlot::Active, point, range.format, range.style)
    }
    /// Insert using the active selection, previous selection, or end of root in that order.
    pub fn insert_nodes_at_selection(&mut self, nodes: &[NodeKey]) -> Result<(), Error> {
        let slot = if self.pending.selection.is_some() {
            SelectionSlot::Active
        } else if let Some(slot) = self.detach_previous_selection()? {
            slot
        } else {
            self.select_end(NodeKey::ROOT)?;
            SelectionSlot::Active
        };
        self.insert_nodes_at(slot, nodes)
    }
    /// Extract active selected nodes, splitting boundary text.
    pub fn extract(&mut self) -> Result<Vec<NodeKey>, Error> {
        self.extract_at(SelectionSlot::Active)
    }
    /// Extract selected nodes without detaching them from the tree.
    pub fn extract_at(&mut self, slot: SelectionSlot) -> Result<Vec<NodeKey>, Error> {
        let selection = self
            .selection_at(slot)?
            .cloned()
            .ok_or(Error::NoSelection)?;
        let Selection::Range(range) = selection else {
            return selection.nodes(self.view());
        };
        let backward = range.is_backward(self.view())?;
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        let mut nodes = range.nodes(self.view())?;
        if range.is_collapsed() {
            return Ok(nodes);
        }
        let (start_offset, end_offset) =
            self.character_offsets(&Selection::Range(range.clone()))?;
        let (from, to) = if backward {
            (end_offset, start_offset)
        } else {
            (start_offset, end_offset)
        };
        if nodes.len() == 1 && self.is_text(nodes[0]) {
            let parts = self.text(nodes[0])?.split_text(&[from, to])?;
            let index = usize::from(from != Utf16Offset::ZERO);
            if let Some(key) = parts.get(index).copied() {
                nodes = vec![key];
                self.set_point_at(
                    slot,
                    if backward {
                        PointRole::Focus
                    } else {
                        PointRole::Anchor
                    },
                    Point::text(key, Utf16Offset::ZERO),
                )?;
                self.set_point_at(
                    slot,
                    if backward {
                        PointRole::Anchor
                    } else {
                        PointRole::Focus
                    },
                    Point::text(key, to - from),
                )?;
            } else {
                nodes.clear();
            }
        } else {
            if let Some(first) = nodes.first().copied().filter(|key| self.is_text(*key)) {
                if from == self.text_content_size(first) {
                    nodes.remove(0);
                } else if from != Utf16Offset::ZERO {
                    let parts = self.text(first)?.split_text(&[from])?;
                    let key = *parts
                        .get(1)
                        .ok_or(Error::Invariant("extract start slice"))?;
                    nodes[0] = key;
                    self.set_point_at(
                        slot,
                        if backward {
                            PointRole::Focus
                        } else {
                            PointRole::Anchor
                        },
                        Point::text(key, Utf16Offset::ZERO),
                    )?;
                }
            }
            if let Some(last) = nodes.last().copied().filter(|key| self.is_text(*key)) {
                if to == Utf16Offset::ZERO {
                    nodes.pop();
                } else if to < self.text_content_size(last) {
                    self.text(last)?.split_text(&[to])?;
                    self.set_point_at(
                        slot,
                        if backward {
                            PointRole::Anchor
                        } else {
                            PointRole::Focus
                        },
                        Point::text(last, to),
                    )?;
                }
            }
        }
        let _ = (start, end);
        Ok(nodes)
    }
}

#[cfg(test)]
mod test;

impl Transaction<'_> {
    /// Split a text boundary and all inline parents up to the containing block.
    pub(crate) fn split_selection_boundary(
        &mut self,
        slot: SelectionSlot,
    ) -> Result<(NodeKey, ChildIndex), Error> {
        let point = self.anchor_at(slot)?;
        let (mut parent, mut index) = match point {
            Point::Element { key, offset } => (key, offset),
            Point::Text { key, offset } => {
                let parent = self.parent_or_err(key)?;
                let index = self.index_within_parent(key).ok_or(Error::NoParent(key))?;
                let len = self.text_content_size(key);
                if offset == Utf16Offset::ZERO {
                    (parent, index)
                } else if offset == len {
                    (parent, ChildIndex(index.0 + 1))
                } else {
                    self.text(key)?.split_text(&[offset])?;
                    (parent, ChildIndex(index.0 + 1))
                }
            }
        };
        while self.is_inline(parent) {
            let outer = self.parent_or_err(parent)?;
            let position = self
                .index_within_parent(parent)
                .ok_or(Error::NoParent(parent))?;
            if index.0 == 0 {
                index = position;
            } else if index.0 == self.children_size(parent) {
                index = ChildIndex(position.0 + 1);
            } else {
                let copy = self.copy_node(parent, false)?;
                let tail = self
                    .children(parent)
                    .skip(index.0 as usize)
                    .collect::<Vec<_>>();
                self.append(copy, &tail)?;
                self.insert_after(parent, copy, false)?;
                index = ChildIndex(position.0 + 1);
            }
            parent = outer;
        }
        Ok((parent, index))
    }
}
