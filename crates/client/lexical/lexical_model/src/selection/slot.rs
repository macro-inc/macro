use crate::*;
impl Transaction<'_> {
    pub(crate) fn try_selection_at(&self, slot: SelectionSlot) -> Option<&Selection> {
        self.selection_at(slot).ok().flatten()
    }
    pub(crate) fn try_range_at(&self, slot: SelectionSlot) -> Option<&RangeSelection> {
        self.try_selection_at(slot).and_then(Selection::as_range)
    }
    /// Borrow a live selection; reject an unknown detached handle.
    pub fn selection_at(&self, slot: SelectionSlot) -> Result<Option<&Selection>, Error> {
        match slot {
            SelectionSlot::Active => Ok(self.pending.selection.as_ref()),
            SelectionSlot::Detached(id) => self
                .detached
                .get(id.0)
                .map(Option::as_ref)
                .ok_or(Error::UnknownSelectionSlot),
        }
    }
    /// Borrow a range, rejecting another selection kind.
    pub fn range_at(&self, slot: SelectionSlot) -> Result<&RangeSelection, Error> {
        self.selection_at(slot)?
            .and_then(Selection::as_range)
            .ok_or(Error::NoRangeSelection)
    }
    /// Compute direction, caching only outside a development read-only peer.
    pub fn range_is_backward_at(&mut self, slot: SelectionSlot) -> Result<bool, Error> {
        let backward = self.range_at(slot)?.is_backward(self.view())?;
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            return Ok(backward);
        }
        let Selection::Range(range) = self.selection_mut_at(slot)? else {
            return Err(Error::NoRangeSelection);
        };
        range.cached_direction = Some((range.anchor, range.focus, backward));
        Ok(backward)
    }
    /// Borrow the active range.
    pub fn range_selection(&self) -> Result<&RangeSelection, Error> {
        self.range_at(SelectionSlot::Active)
    }
    pub(crate) fn selection_mut_at(
        &mut self,
        slot: SelectionSlot,
    ) -> Result<&mut Selection, Error> {
        self.guard_write()?;
        self.selection_value_mut_at(slot)
    }
    fn selection_value_mut_at(&mut self, slot: SelectionSlot) -> Result<&mut Selection, Error> {
        match slot {
            SelectionSlot::Active => self.pending.selection.as_mut().ok_or(Error::NoSelection),
            SelectionSlot::Detached(id) => self
                .detached
                .get_mut(id.0)
                .ok_or(Error::UnknownSelectionSlot)?
                .as_mut()
                .ok_or(Error::NoSelection),
        }
    }
    pub(crate) fn install_selection_at(
        &mut self,
        slot: SelectionSlot,
        mut selection: Selection,
    ) -> Result<(), Error> {
        if let Selection::Range(range) = &mut selection {
            range.invalidate_changed_direction();
        }
        match slot {
            SelectionSlot::Active => self.set_selection(Some(selection)),
            SelectionSlot::Detached(_) => {
                *self.selection_mut_at(slot)? = selection;
                Ok(())
            }
        }
    }
    /// Take a detached value, or clone the active selection.
    pub fn take_detached(&mut self, slot: SelectionSlot) -> Result<Selection, Error> {
        match slot {
            SelectionSlot::Active => self.pending.selection.clone().ok_or(Error::NoSelection),
            SelectionSlot::Detached(id) => self
                .detached
                .get_mut(id.0)
                .ok_or(Error::UnknownSelectionSlot)?
                .take()
                .ok_or(Error::NoSelection),
        }
    }
    /// Copy the previous committed selection into a detached slot.
    pub fn detach_previous_selection(&mut self) -> Result<Option<SelectionSlot>, Error> {
        self.guard_write()?;
        Ok(self
            .previous_selection()
            .cloned()
            .map(|selection| self.detach_selection(selection)))
    }
    /// Read the current anchor in a slot.
    pub fn anchor_at(&self, slot: SelectionSlot) -> Result<Point, Error> {
        Ok(self.range_at(slot)?.anchor)
    }
    /// Read the current focus in a slot.
    pub fn focus_at(&self, slot: SelectionSlot) -> Result<Point, Error> {
        Ok(self.range_at(slot)?.focus)
    }
    /// Read the active anchor.
    pub fn anchor(&self) -> Result<Point, Error> {
        self.anchor_at(SelectionSlot::Active)
    }
    /// Read the active focus.
    pub fn focus(&self) -> Result<Point, Error> {
        self.focus_at(SelectionSlot::Active)
    }
    /// Update a live point with composition transfer and selection dirtiness.
    /// A development read-only peer changes only its own selection value.
    pub fn set_point_at(
        &mut self,
        slot: SelectionSlot,
        role: PointRole,
        point: Point,
    ) -> Result<(), Error> {
        #[cfg(feature = "foreign-nodes")]
        ForeignReadOperation::check()?;
        #[cfg(feature = "foreign-nodes")]
        if self.foreign_read_only {
            self.check_point_type(point)?;
            let Selection::Range(range) = self.selection_value_mut_at(slot)? else {
                return Err(Error::NoRangeSelection);
            };
            let cached = range.cached_is_backward();
            match role {
                PointRole::Anchor => range.anchor = point,
                PointRole::Focus => range.focus = point,
            }
            // Upstream Point.set leaves _cachedIsBackward untouched in read
            // mode, even if the new endpoints have a different direction.
            range.cached_direction = cached.map(|backward| (range.anchor, range.focus, backward));
            return Ok(());
        }
        self.guard_write()?;
        self.check_point_type(point)?;
        let old = match role {
            PointRole::Anchor => self.anchor_at(slot)?,
            PointRole::Focus => self.focus_at(slot)?,
        };
        if self.composition_key() == Some(old.key()) {
            self.set_composition_key(Some(point.key()))?;
        }
        let selection = self.selection_mut_at(slot)?;
        let Selection::Range(range) = selection else {
            return Err(Error::NoRangeSelection);
        };
        range.clear_direction_cache();
        match role {
            PointRole::Anchor => range.anchor = point,
            PointRole::Focus => range.focus = point,
        }
        range.cached_direction = None;
        range.dirty = true;
        if slot == SelectionSlot::Active {
            self.selection_dirty = true;
            self.dirty_since_flush = true;
        }
        Ok(())
    }
    fn check_point_type(&self, point: Point) -> Result<(), Error> {
        let correct = match point {
            Point::Text { .. } => self.is_text(point.key()),
            Point::Element { .. } => self.is_element(point.key()),
        };
        if !correct {
            return Err(Error::PointTypeMismatch);
        }
        Ok(())
    }
    /// Update an active endpoint.
    pub fn set_point(&mut self, role: PointRole, point: Point) -> Result<(), Error> {
        self.set_point_at(SelectionSlot::Active, role, point)
    }
    /// Set both text endpoints in a slot.
    pub fn set_text_node_range_at(
        &mut self,
        slot: SelectionSlot,
        anchor: impl Into<NodeKey>,
        anchor_offset: Utf16Offset,
        focus: impl Into<NodeKey>,
        focus_offset: Utf16Offset,
    ) -> Result<(), Error> {
        self.set_point_at(slot, PointRole::Anchor, Point::text(anchor, anchor_offset))?;
        self.set_point_at(slot, PointRole::Focus, Point::text(focus, focus_offset))
    }
    /// Set both active text endpoints.
    pub fn set_text_node_range(
        &mut self,
        anchor: impl Into<NodeKey>,
        anchor_offset: Utf16Offset,
        focus: impl Into<NodeKey>,
        focus_offset: Utf16Offset,
    ) -> Result<(), Error> {
        self.set_text_node_range_at(
            SelectionSlot::Active,
            anchor,
            anchor_offset,
            focus,
            focus_offset,
        )
    }
}
