//! Inline and block node insertion.
use crate::*;
impl Transaction<'_> {
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
                self.replace_selection(Some(Selection::Range(RangeSelection::collapsed(point))))?;
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
        let slot = if self.anchor_at(slot)?.key() == NodeKey::ROOT {
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
        let first_block_writable = self.is_writable(first_block);
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
                match self
                    .next_sibling(last)
                    .filter(|key| self.is_text(*key) || self.is_element(*key))
                {
                    Some(next) => self.element_select_point(next, false)?,
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
        let last_inserted_block =
            self.find_matching_parent(select, |state, key| state.is_block(key));
        if let Some(trailing) = trailing
            && let Some(last_block) = last_inserted_block.filter(|key| self.is_element(*key))
            && (self.can_merge_when_empty(trailing) || self.is_block(last))
        {
            let children = self.children_keys(trailing)?;
            self.append(last_block, &children)?;
            self.remove(trailing, false)?;
        }
        if self.is_empty(block) {
            self.remove(block, false)?;
        }
        // Upstream compares captured node objects here. A frozen block gains
        // a new writable identity during insertion even when its key matches.
        if (last_inserted_block != Some(block) || !first_block_writable)
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
}
