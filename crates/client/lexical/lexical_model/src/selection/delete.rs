use crate::*;
impl Transaction<'_> {
    pub(crate) fn selection_block(&self, point: Point) -> Option<NodeKey> {
        self.find_matching_parent(point.key(), |view, key| view.is_block(key))
    }
    pub(crate) fn collapsed_selection_at(
        &mut self,
        slot: SelectionSlot,
        point: Point,
        format: TextFormat,
        style: std::sync::Arc<str>,
    ) -> Result<(), Error> {
        let mut range = RangeSelection::collapsed(point);
        range.format = format;
        range.style = style;
        range.dirty = true;
        self.install_selection_at(slot, Selection::Range(range))
    }
    /// Delete selected text and collapse the active range.
    pub fn remove_text(&mut self) -> Result<(), Error> {
        self.remove_text_at(SelectionSlot::Active)
    }
    /// Delete a range, including whole tokens and selected containers.
    pub fn remove_text_at(&mut self, slot: SelectionSlot) -> Result<(), Error> {
        self.remove_range(slot, false)
    }
    pub(crate) fn remove_range(
        &mut self,
        slot: SelectionSlot,
        preserve_first: bool,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let mut range = self.range_at(slot)?.clone();
        if range.is_collapsed() {
            // Caret-range removal still refreshes the active selection upstream.
            return self.collapsed_selection_at(slot, range.anchor, range.format, range.style);
        }
        // Caret conversion descends noncollapsed element boundaries before removal.
        normalize_range_selection(self.view(), &mut range)?;
        if range.is_collapsed() {
            return self.collapsed_selection_at(slot, range.anchor, range.format, range.style);
        }
        let backward = range.is_backward(self.view())?;
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        let nodes = range.nodes(self.view())?;
        let original_last_block = self.selection_block(end);
        let mut candidates = vec![start];
        let mut key = start.key();
        while let Some(parent) = self.parent(key) {
            if let Some(previous) = self.prev_sibling(key) {
                candidates.push(self.end_point(previous)?);
            }
            candidates.push(Point::element(
                parent,
                self.index_within_parent(key).unwrap_or(ChildIndex(0)),
            ));
            key = parent;
        }
        let mut complete_elements = crate::collections::IndexSet::default();
        for node in &nodes {
            if self.is_element(*node)
                && *node != NodeKey::ROOT
                && *node != start.key()
                && *node != end.key()
                && !self.has_ancestor(start.key(), *node)
                && !self.has_ancestor(end.key(), *node)
            {
                let before = Point::element(*node, ChildIndex(0));
                let after = Point::element(*node, ChildIndex(self.children_size(*node)));
                if !before.is_before(self.view(), &start)? && !end.is_before(self.view(), &after)? {
                    complete_elements.insert(*node);
                }
            }
        }
        let mut replacement_start = None;
        for node in nodes {
            if !self.contains(node) || !self.is_attached(node) {
                continue;
            }
            if let Some(data) = self.view().text(node) {
                let len = data.text.utf16_len();
                let from = if node == start.key() {
                    Utf16Offset(start.offset())
                } else {
                    Utf16Offset::ZERO
                };
                let to = if node == end.key() {
                    Utf16Offset(end.offset())
                } else {
                    len
                };
                if from >= to {
                    continue;
                }
                if (from == Utf16Offset::ZERO
                    && to == len
                    && !(preserve_first && node == start.key()))
                    || self.is_token_or_tab(node)
                {
                    self.remove(node, false)?;
                } else {
                    let segmented = data.is_segmented();
                    let format = data.format;
                    let style = data.style.clone();
                    self.text(node)?.splice_text(from..to, "", false)?;
                    let survivor = if segmented {
                        let text = self.text_content(node).into_owned();
                        let plain = self.create_text(&text)?;
                        self.text(plain)?.set_format(format)?.set_style(&style)?;
                        self.replace(node, plain, false)?;
                        plain.key()
                    } else {
                        node
                    };
                    if node == start.key() {
                        replacement_start = Some(Point::text(survivor, from));
                    }
                }
            } else if self.is_element(node) {
                if complete_elements.contains(&node) {
                    self.remove(node, false)?;
                }
            } else {
                self.remove(node, false)?;
            }
        }
        let surviving_start = replacement_start.or_else(|| {
            candidates
                .iter()
                .copied()
                .find(|point| self.is_attached(point.key()))
        });
        let end_container = if self.is_attached(end.key()) {
            if self.is_element(end.key()) {
                Some(end.key())
            } else {
                self.parent(end.key())
            }
        } else {
            original_last_block.filter(|key| self.is_attached(*key))
        };
        let targets = surviving_start.zip(end_container).and_then(|(start, end)| {
            let start = if self.is_element(start.key()) {
                start.key()
            } else {
                self.parent(start.key())?
            };
            let mut left = vec![start];
            left.extend(self.ancestors(start));
            left.reverse();
            let mut right = vec![end];
            right.extend(self.ancestors(end));
            right.reverse();
            let common = left.iter().zip(&right).take_while(|(a, b)| a == b).count();
            let pick = |path: &[NodeKey]| {
                let mut block = None;
                for key in &path[common..] {
                    if self.is_root_or_shadow_root(*key) {
                        return None;
                    }
                    if block.is_none() && self.view().is_block(*key) {
                        block = Some(*key);
                    }
                }
                block
            };
            pick(&left).zip(pick(&right))
        });
        if let Some((first, last)) = targets
            && first != last
            && self.is_attached(first)
            && self.is_attached(last)
            && self.nearest_root_or_shadow_root(first)? == self.nearest_root_or_shadow_root(last)?
        {
            let children = self.children_keys(last)?;
            self.append(first, &children)?;
            let mut parent = self.parent(last);
            self.remove(last, true)?;
            while let Some(key) = parent {
                if self.is_root_or_shadow_root(key) || !self.is_empty(key) {
                    break;
                }
                parent = self.parent(key);
                self.remove(key, true)?;
            }
        }
        if let Some(point) = replacement_start {
            candidates.insert(0, point);
        }
        candidates.push(end);
        candidates.push(Point::element(NodeKey::ROOT, ChildIndex(0)));
        let mut point = candidates
            .into_iter()
            .find(|point| self.is_attached(point.key()))
            .ok_or(Error::SelectionLost)?;
        if let Point::Element { key, offset } = point {
            point = Point::element(key, ChildIndex(offset.0.min(self.children_size(key))));
        }
        let mut collapsed = RangeSelection::collapsed(point);
        normalize_range_selection(self.view(), &mut collapsed)?;
        self.collapsed_selection_at(slot, collapsed.anchor, range.format, range.style)
    }
    /// Delete the nodes in the active node selection.
    pub fn delete_nodes(&mut self) -> Result<(), Error> {
        self.delete_nodes_at(SelectionSlot::Active)
    }
    /// Delete a node selection, relocating only the active selection.
    pub fn delete_nodes_at(&mut self, slot: SelectionSlot) -> Result<(), Error> {
        let selection = self
            .selection_at(slot)?
            .and_then(Selection::as_node)
            .ok_or(Error::NoNodeSelection)?
            .clone();
        let nodes = selection.nodes(self.view());
        if slot == SelectionSlot::Active
            && let Some(first) = nodes.first()
        {
            self.select_previous(*first, None, None)?;
        }
        for key in nodes {
            self.remove(key, false)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
