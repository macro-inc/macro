//! Boundary operations shared by selection edits.
use crate::*;
impl Transaction<'_> {
    /// Expand the active selection to the whole document, or a supplied slot's root.
    pub fn select_all(&mut self, expand: Option<SelectionSlot>) -> Result<(), Error> {
        let slot = expand.unwrap_or(SelectionSlot::Active);
        let root = if expand.is_some() {
            let anchor = self.anchor_at(slot)?;
            self.nearest_root_or_shadow_root(anchor.key())?
        } else {
            NodeKey::ROOT
        };
        if self.try_range_at(slot).is_none() {
            self.install_selection_at(slot, Selection::Range(RangeSelection::at_root()))?;
        }
        self.set_point_at(slot, PointRole::Anchor, Point::element(root, ChildIndex(0)))?;
        self.set_point_at(
            slot,
            PointRole::Focus,
            Point::element(root, ChildIndex(self.children_size(root))),
        )?;
        self.normalize_selection_at(slot)
    }
    /// Trim focus that extends beyond the last selected content after a triple click.
    pub fn fix_focus_overselection(&mut self) -> Result<bool, Error> {
        let Some(range) = self.try_range_at(SelectionSlot::Active).cloned() else {
            return Ok(false);
        };
        if range.is_collapsed() {
            return Ok(false);
        }
        let backward = range.is_backward(self.view())?;
        let anchor = if backward { range.focus } else { range.anchor };
        let mut point = if backward { range.anchor } else { range.focus };
        let original = point;
        let mut skipped_break = false;
        while point.offset() == 0 && point.key() != anchor.key() {
            if let Some(previous) = self.prev_sibling(point.key()) {
                if self.is_line_break(previous) && !skipped_break {
                    skipped_break = true;
                    point = Point::element(
                        self.parent_or_err(previous)?,
                        self.index_within_parent(previous)
                            .ok_or(Error::NoParent(previous))?,
                    );
                } else {
                    point = self.end_point(previous)?;
                    break;
                }
            } else {
                let Some(parent) = self.parent(point.key()) else {
                    break;
                };
                let Some(index) = self.index_within_parent(point.key()) else {
                    break;
                };
                point = Point::element(parent, index);
            }
        }
        point = super::comparison_point(self.view(), point)?;
        if point == original {
            return Ok(false);
        }
        self.set_point(PointRole::Anchor, anchor)?;
        self.set_point(PointRole::Focus, point)?;
        Ok(true)
    }
}
