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
        let identity = self.selection_replacements;
        let result = self.remove_range(slot, false);
        // RangeSelection.removeText restores its original selection object after
        // caret-based replacements, so those transient clones do not escape.
        if result.is_ok() {
            self.selection_replacements = identity;
        }
        result
    }
    pub(crate) fn remove_range(
        &mut self,
        slot: SelectionSlot,
        preserve_first: bool,
    ) -> Result<(), Error> {
        self.remove_caret_range(slot, preserve_first)
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
