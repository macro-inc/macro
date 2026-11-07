use crate::*;
mod structural;
/// Whether movement replaces or extends a range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Alter {
    /// Move the caret.
    Move,
    /// Extend from the existing anchor.
    Extend,
}
/// Layout movement unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Granularity {
    /// One grapheme cluster.
    Character,
    /// One word.
    Word,
    /// Current visual line boundary.
    LineBoundary,
}
/// Result of a host layout query, or an explicit model-only policy.
#[derive(Clone, Debug, PartialEq)]
pub enum ModifyTarget {
    /// Layout is unavailable; only structural movement runs.
    NoView,
    /// Points returned by the view.
    View {
        /// Host anchor.
        anchor: Point,
        /// Host focus.
        focus: Point,
        /// Resolution adjusted the DOM position.
        resolution_dirty: bool,
        /// Host range is reversed.
        is_backward_in_dom: bool,
    },
    /// Use Unicode segmentation within a text node.
    #[cfg(feature = "model-segmentation")]
    ModelSegmentation,
}
impl Transaction<'_> {
    /// Move or extend the active range using host layout information.
    pub fn modify_selection(
        &mut self,
        alter: Alter,
        direction: EditDirection,
        granularity: Granularity,
        target: ModifyTarget,
    ) -> Result<(), Error> {
        self.modify_selection_at(SelectionSlot::Active, alter, direction, granularity, target)
    }
    /// Move a selection, first handling structural block and decorator boundaries.
    pub fn modify_selection_at(
        &mut self,
        slot: SelectionSlot,
        alter: Alter,
        direction: EditDirection,
        granularity: Granularity,
        target: ModifyTarget,
    ) -> Result<(), Error> {
        let range = self.range_at(slot)?.clone();
        let backward = direction == EditDirection::Backward;
        if alter == Alter::Move && granularity == Granularity::Character && !range.is_collapsed() {
            let point = if backward == range.is_backward(self.view())? {
                range.focus
            } else {
                range.anchor
            };
            return self.collapsed_selection_at(slot, point, range.format, range.style);
        }
        if self.modify_structural_boundary(slot, alter, direction, granularity, true)? {
            return Ok(());
        }
        match target {
            ModifyTarget::NoView => Ok(()),
            ModifyTarget::View {
                anchor,
                focus,
                resolution_dirty: _,
                is_backward_in_dom,
            } => {
                let mut next = RangeSelection::new(anchor, focus);
                self.normalize_view_boundaries(&mut next)?;
                if alter == Alter::Extend && is_backward_in_dom {
                    std::mem::swap(&mut next.anchor, &mut next.focus);
                }
                // Clamp the oriented focus, not the host range's sorted end.
                if alter == Alter::Extend
                    && self.nearest_root_or_shadow_root(range.anchor.key())?
                        != self.nearest_root_or_shadow_root(next.focus.key())?
                {
                    let root = self.nearest_root_or_shadow_root(range.anchor.key())?;
                    next.focus = if backward {
                        self.start_point(root)?
                    } else {
                        self.end_point(root)?
                    };
                }
                next.format = range.format;
                next.style = range.style;
                self.install_selection_at(slot, Selection::Range(next))?;
                if granularity == Granularity::LineBoundary {
                    self.modify_structural_boundary(slot, alter, direction, granularity, false)?;
                }
                Ok(())
            }
            #[cfg(feature = "model-segmentation")]
            ModifyTarget::ModelSegmentation => {
                use unicode_segmentation::UnicodeSegmentation;
                if granularity == Granularity::LineBoundary {
                    return Err(Error::LayoutRequired);
                }
                let Point::Text { key, offset } = range.focus else {
                    return Ok(());
                };
                let buffer = &self.view().text_data(key)?.text;
                let text = buffer.as_str();
                let byte = buffer.byte_offset(offset)?;
                let mut boundaries: Vec<usize> = match granularity {
                    Granularity::Character => text
                        .grapheme_indices(true)
                        .map(|(index, _)| index)
                        .collect(),
                    Granularity::Word => text
                        .split_word_bound_indices()
                        .map(|(index, _)| index)
                        .collect(),
                    Granularity::LineBoundary => return Err(Error::LayoutRequired),
                };
                boundaries.push(text.len());
                let next = if backward {
                    boundaries
                        .into_iter()
                        .rfind(|index| *index < byte)
                        .unwrap_or(0)
                } else {
                    boundaries
                        .into_iter()
                        .find(|index| *index > byte)
                        .unwrap_or(text.len())
                };
                let offset = Utf16Offset(
                    text.get(..next)
                        .ok_or(Error::Invariant("segmentation byte boundary"))?
                        .encode_utf16()
                        .count() as u32,
                );
                self.set_point_at(slot, PointRole::Focus, Point::text(key, offset))?;
                if alter == Alter::Move {
                    self.set_point_at(slot, PointRole::Anchor, Point::text(key, offset))?;
                }
                Ok(())
            }
        }
    }
    /// Delete one logical character from the active selection.
    pub fn delete_character(
        &mut self,
        direction: EditDirection,
        target: ModifyTarget,
    ) -> Result<(), Error> {
        self.delete_character_at(SelectionSlot::Active, direction, target)
    }
    /// Delete selected content or extend by a character before deletion.
    pub fn delete_character_at(
        &mut self,
        slot: SelectionSlot,
        direction: EditDirection,
        target: ModifyTarget,
    ) -> Result<(), Error> {
        let target_for_unicode = matches!(&target, ModifyTarget::View { .. });
        let range = self.range_at(slot)?.clone();
        if range.is_collapsed() && range.forward_deletion(self.view(), direction)? {
            return Ok(());
        }
        if range.is_collapsed() {
            if self.delete_structural_boundary(slot, direction)? {
                return Ok(());
            }
            self.modify_selection_at(
                slot,
                Alter::Extend,
                direction,
                Granularity::Character,
                target,
            )?;
            // DOM targets can name the middle of a surrogate pair; deletion consumes
            // the complete scalar, never half of its UTF-16 representation.
            let focus = self.focus_at(slot)?;
            if let Point::Text { key, offset } = focus
                && self
                    .view()
                    .text_data(key)?
                    .text
                    .code_unit_at(offset)
                    .is_some_and(|unit| (0xdc00..=0xdfff).contains(&unit))
            {
                let corrected = if direction == EditDirection::Backward {
                    offset.saturating_sub(Utf16Offset(1))
                } else {
                    offset + Utf16Offset(1)
                };
                self.set_point_at(slot, PointRole::Focus, Point::text(key, corrected))?;
            }
            let changed = self.range_at(slot)?.clone();
            if target_for_unicode
                && changed.anchor.key() == changed.focus.key()
                && let (Point::Text { key, offset: a }, Point::Text { offset: b, .. }) =
                    (changed.anchor, changed.focus)
                && a.get().abs_diff(b.get()) > 1
            {
                let slice = self.view().text_data(key)?.text.slice(a.min(b)..a.max(b))?;
                if !slice.chars().any(|ch| ch.len_utf16() > 1)
                    && !super::emoji::contains_bmp_emoji(slice)
                {
                    let point = Point::text(key, a.max(b) - Utf16Offset(1));
                    self.set_point_at(
                        slot,
                        if direction == EditDirection::Backward {
                            PointRole::Focus
                        } else {
                            PointRole::Anchor
                        },
                        point,
                    )?;
                }
            }
            let changed = self.range_at(slot)?.clone();
            if !changed.is_collapsed() {
                let focus = changed.focus;
                let anchor = changed.anchor;
                let is_backward = direction == EditDirection::Backward;
                if self
                    .view()
                    .text(focus.key())
                    .is_some_and(TextData::is_segmented)
                {
                    if focus.key() == anchor.key()
                        || (is_backward
                            && focus.offset() != self.text_content_size(focus.key()).get())
                        || (!is_backward && focus.offset() != 0)
                    {
                        return self.remove_segment_at(slot, focus, direction);
                    }
                } else if self
                    .view()
                    .text(anchor.key())
                    .is_some_and(TextData::is_segmented)
                    && (anchor.key() == focus.key()
                        || (is_backward && anchor.offset() != 0)
                        || (!is_backward
                            && anchor.offset() != self.text_content_size(anchor.key()).get()))
                {
                    return self.remove_segment_at(slot, anchor, direction);
                }
            }
            if changed.is_collapsed()
                && direction == EditDirection::Backward
                && changed.anchor.offset() == 0
            {
                let mut node = Some(changed.anchor.key());
                while let Some(key) = node {
                    if self.is_element(key) {
                        if self.collapse_at_start(key, slot)? {
                            return Ok(());
                        }
                        if self.is_root_or_shadow_root(key) {
                            break;
                        }
                    }
                    if self.prev_sibling(key).is_some() {
                        break;
                    }
                    node = self.parent(key);
                }
            }
        }
        self.remove_text_at(slot)
    }
    fn remove_segment_at(
        &mut self,
        slot: SelectionSlot,
        point: Point,
        direction: EditDirection,
    ) -> Result<(), Error> {
        let key = point.key();
        let text = self.text_content(key).into_owned();
        let mut boundaries = vec![0usize];
        boundaries.extend(
            text.char_indices()
                .filter_map(|(index, ch)| (is_ecma_whitespace(ch) && index != 0).then_some(index)),
        );
        boundaries.push(text.len());
        let offset = self
            .view()
            .text_data(key)?
            .text
            .byte_offset(Utf16Offset(point.offset()))?;
        let segment = boundaries.windows(2).enumerate().find(|(_, pair)| {
            (direction == EditDirection::Backward && pair[1] == offset)
                || pair[1] > offset
                || pair[1] == text.len()
        });
        if let Some((index, pair)) = segment {
            let prefix = text
                .get(..pair[0])
                .ok_or(Error::Invariant("segment start"))?;
            let suffix = text.get(pair[1]..).ok_or(Error::Invariant("segment end"))?;
            let next = format!("{prefix}{suffix}")
                .trim_matches(is_ecma_whitespace)
                .to_owned();
            if next.is_empty() {
                self.remove(key, false)?;
            } else {
                let restore = if index + 2 == boundaries.len() {
                    next.encode_utf16().count() as u32
                } else {
                    prefix.encode_utf16().count() as u32
                };
                self.text(key)?.set_text_content(&next)?;
                let range = self.range_at(slot)?.clone();
                self.collapsed_selection_at(
                    slot,
                    Point::text(key, Utf16Offset(restore)),
                    range.format,
                    range.style,
                )?;
            }
        }
        Ok(())
    }
    /// Delete one word, using a separate character fallback target.
    pub fn delete_word(
        &mut self,
        direction: EditDirection,
        target: ModifyTarget,
        character_target: ModifyTarget,
    ) -> Result<(), Error> {
        self.delete_word_at(SelectionSlot::Active, direction, target, character_target)
    }
    /// Delete a word in a selection slot.
    pub fn delete_word_at(
        &mut self,
        slot: SelectionSlot,
        direction: EditDirection,
        target: ModifyTarget,
        character_target: ModifyTarget,
    ) -> Result<(), Error> {
        self.delete_unit_at(slot, direction, Granularity::Word, target, character_target)
    }
    /// Delete to the visual line boundary.
    pub fn delete_line(
        &mut self,
        direction: EditDirection,
        target: ModifyTarget,
        character_target: ModifyTarget,
    ) -> Result<(), Error> {
        self.delete_line_at(SelectionSlot::Active, direction, target, character_target)
    }
    /// Delete to a line boundary in a selection slot.
    pub fn delete_line_at(
        &mut self,
        slot: SelectionSlot,
        direction: EditDirection,
        target: ModifyTarget,
        character_target: ModifyTarget,
    ) -> Result<(), Error> {
        self.delete_unit_at(
            slot,
            direction,
            Granularity::LineBoundary,
            target,
            character_target,
        )
    }
    fn delete_unit_at(
        &mut self,
        slot: SelectionSlot,
        direction: EditDirection,
        granularity: Granularity,
        target: ModifyTarget,
        character_target: ModifyTarget,
    ) -> Result<(), Error> {
        if self
            .range_at(slot)?
            .forward_deletion(self.view(), direction)?
        {
            return Ok(());
        }
        if self.range_at(slot)?.is_collapsed() {
            self.modify_selection_at(slot, Alter::Extend, direction, granularity, target)?;
        }
        if self.range_at(slot)?.is_collapsed() {
            self.delete_character_at(slot, direction, character_target)
        } else {
            self.remove_text_at(slot)
        }
    }
}

#[cfg(test)]
mod test;

fn is_ecma_whitespace(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
