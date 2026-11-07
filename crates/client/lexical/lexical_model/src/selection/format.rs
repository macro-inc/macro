use crate::*;
impl RangeSelection {
    /// Toggle one typing format, preserving mutually exclusive groups.
    pub fn toggle_format(&mut self, format: TextFormatType) {
        self.format = self.format.toggled(format, None);
        self.dirty = true;
    }
    /// Replace typing formats.
    pub fn set_format(&mut self, format: TextFormat) {
        self.format = format;
        self.dirty = true;
    }
    /// Replace typing style.
    pub fn set_style(&mut self, style: &str) {
        self.style = style.into();
        self.dirty = true;
    }
    /// Test a typing format.
    pub fn has_format(&self, format: TextFormatType) -> bool {
        self.format.has(format)
    }
}
impl Transaction<'_> {
    /// Set typing format for a slot.
    pub fn set_selection_format_at(
        &mut self,
        slot: SelectionSlot,
        format: TextFormat,
    ) -> Result<(), Error> {
        let Selection::Range(range) = self.selection_mut_at(slot)? else {
            return Err(Error::NoRangeSelection);
        };
        range.set_format(format);
        if slot == SelectionSlot::Active {
            self.selection_dirty = true;
            self.dirty_since_flush = true;
        }
        Ok(())
    }
    /// Set typing style for a slot.
    pub fn set_selection_style_at(
        &mut self,
        slot: SelectionSlot,
        style: &str,
    ) -> Result<(), Error> {
        let Selection::Range(range) = self.selection_mut_at(slot)? else {
            return Err(Error::NoRangeSelection);
        };
        range.set_style(style);
        if slot == SelectionSlot::Active {
            self.selection_dirty = true;
            self.dirty_since_flush = true;
        }
        Ok(())
    }
    /// Toggle typing format for a slot.
    pub fn toggle_selection_format_at(
        &mut self,
        slot: SelectionSlot,
        format: TextFormatType,
    ) -> Result<(), Error> {
        let current = self.range_at(slot)?.format.toggled(format, None);
        self.set_selection_format_at(slot, current)
    }
    /// Set active typing format.
    pub fn set_selection_format(&mut self, format: TextFormat) -> Result<(), Error> {
        self.set_selection_format_at(SelectionSlot::Active, format)
    }
    /// Set active typing style.
    pub fn set_selection_style(&mut self, style: &str) -> Result<(), Error> {
        self.set_selection_style_at(SelectionSlot::Active, style)
    }
    /// Toggle active typing format.
    pub fn toggle_selection_format(&mut self, format: TextFormatType) -> Result<(), Error> {
        self.toggle_selection_format_at(SelectionSlot::Active, format)
    }
    /// Format the selected text, splitting partially selected text records.
    pub fn format_text_at(
        &mut self,
        slot: SelectionSlot,
        format: TextFormatType,
        align_with: Option<TextFormat>,
    ) -> Result<(), Error> {
        let range = self.range_at(slot)?.clone();
        if range.is_collapsed() {
            self.toggle_selection_format_at(slot, format)?;
            self.set_composition_key(None)?;
            return Ok(());
        }
        let backward = range.is_backward(self.view())?;
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        let nodes = range.nodes(self.view())?;
        let has_text = nodes.iter().any(|key| self.is_text(*key));
        if !has_text {
            self.toggle_selection_format_at(slot, format)?;
            self.set_composition_key(None)?;
        }
        let first_flags = nodes
            .iter()
            .filter_map(|key| self.view().text(*key).map(|data| (*key, data)))
            .find(|(key, data)| {
                !(*key == start.key() && start.offset() == data.text.utf16_len().get())
            })
            .map(|(_, data)| data.format.toggled(format, align_with));
        let alignment = first_flags.or(align_with);
        let last_text = nodes.iter().rev().copied().find(|key| self.is_text(*key));
        let last_flags = last_text.and_then(|key| self.view().text(key))
            .map(|data| data.format.toggled(format, alignment));
        let tail_partial = last_text.is_some_and(|key| {
            end.key() == key && end.offset() < self.text_content_size(key).get()
        });
        let mut first_target = None;
        for node in &nodes {
            if self.is_element(*node) {
                let current = self.view().element_data(*node)?.text_format;
                self.element(*node)?
                    .set_text_format(current.toggled(format, alignment))?;
            }
        }
        for node in nodes {
            let Some(data) = self.view().text(node) else {
                continue;
            };
            if !self.can_have_format(node) {
                continue;
            }
            let size = data.text.utf16_len();
            let from = if node == start.key() {
                Utf16Offset(start.offset())
            } else {
                Utf16Offset::ZERO
            };
            let to = if node == end.key() {
                Utf16Offset(end.offset())
            } else {
                size
            };
            if from >= to {
                continue;
            }
            let unsplit = self.is_token_or_segmented(node) || self.is::<Tab>(node);
            let target = if unsplit {
                node
            } else {
                let parts = self.text(node)?.split_text(&[from, to])?;
                let index = usize::from(from != Utf16Offset::ZERO);
                *parts
                    .get(index)
                    .ok_or(Error::Invariant("formatted text slice missing"))?
            };
            first_target.get_or_insert(target);
            let flags = self
                .view()
                .text(target)
                .ok_or(Error::NotAText(target))?
                .format
                .toggled(format, alignment);
            self.text(target)?.set_format(flags)?;
            // Detached endpoints are not moved by split_text's active-selection adjustment.
            if node == start.key() && !unsplit {
                self.set_point_at(
                    slot,
                    if backward {
                        PointRole::Focus
                    } else {
                        PointRole::Anchor
                    },
                    Point::text(target, Utf16Offset::ZERO),
                )?;
            }
            if node == end.key() && !unsplit {
                self.set_point_at(
                    slot,
                    if backward {
                        PointRole::Anchor
                    } else {
                        PointRole::Focus
                    },
                    Point::text(target, to - from),
                )?;
            }
        }
        if let Some(first) = first_target {
            let current = self.range_at(slot)?;
            let current_start = if backward { current.focus } else { current.anchor };
            let converted = start.point_type() == PointType::Element && current_start.point_type() == PointType::Text;
            if converted || start.point_type() == PointType::Text
                && first != start.key()
                && (Some(first) != last_text || tail_partial)
            {
                self.set_point_at(
                    slot,
                    if backward {
                        PointRole::Focus
                    } else {
                        PointRole::Anchor
                    },
                    Point::text(first, Utf16Offset::ZERO),
                )?;
            }
        }
        if let Some(flags) = first_flags
            .zip(last_flags)
            .map(|(first, last)| first | last)
        {
            self.set_selection_format_at(slot, flags)?;
        }
        Ok(())
    }
    /// Format active selected text.
    pub fn format_text(
        &mut self,
        format: TextFormatType,
        align_with: Option<TextFormat>,
    ) -> Result<(), Error> {
        self.format_text_at(SelectionSlot::Active, format, align_with)
    }
}
