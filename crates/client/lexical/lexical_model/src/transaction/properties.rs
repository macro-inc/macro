//! Property handles borrow a transaction for the duration of an edit.
use crate::*;
use std::{ops::Range, sync::Arc};
/// Mutable element properties.
pub struct ElementMut<'tx, 'editor> {
    tx: &'tx mut Transaction<'editor>,
    key: NodeKey,
}
/// Mutable text properties.
pub struct TextMut<'tx, 'editor> {
    tx: &'tx mut Transaction<'editor>,
    key: NodeKey,
}
impl<'editor> Transaction<'editor> {
    /// Borrow a mutable element handle.
    pub fn element(&mut self, key: impl Into<NodeKey>) -> Result<ElementMut<'_, 'editor>, Error> {
        let key = key.into();
        self.view().element(key).ok_or(Error::NotAnElement(key))?;
        Ok(ElementMut { tx: self, key })
    }
    /// Borrow a mutable text handle.
    pub fn text(&mut self, key: impl Into<NodeKey>) -> Result<TextMut<'_, 'editor>, Error> {
        let key = key.into();
        self.view().text(key).ok_or(Error::NotAText(key))?;
        Ok(TextMut { tx: self, key })
    }
}
impl ElementMut<'_, '_> {
    /// Element identity.
    pub fn key(&self) -> NodeKey {
        self.key
    }
    /// Current element fields.
    pub fn data(&self) -> &ElementData {
        static EMPTY: std::sync::LazyLock<ElementData> =
            std::sync::LazyLock::new(ElementData::default);
        self.tx.view().element(self.key).unwrap_or(&EMPTY)
    }
    /// Set format and mark the element dirty.
    pub fn set_format(&mut self, value: ElementFormat) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let BaseData::Element(data) = &mut self.tx.writable(self.key)?.base else {
            return Err(Error::NotAnElement(self.key));
        };
        data.absent.remove(crate::node::AbsentKeys::field("format"));
        data.format = value;
        Ok(self)
    }
    /// Set style and mark the element dirty.
    pub fn set_style(&mut self, value: &str) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let BaseData::Element(data) = &mut self.tx.writable(self.key)?.base else {
            return Err(Error::NotAnElement(self.key));
        };
        data.absent.remove(crate::node::AbsentKeys::field("style"));
        data.style = Arc::from(value);
        Ok(self)
    }
    /// Set direction and mark the element dirty.
    pub fn set_direction(&mut self, value: Option<TextDirection>) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let BaseData::Element(data) = &mut self.tx.writable(self.key)?.base else {
            return Err(Error::NotAnElement(self.key));
        };
        data.absent
            .remove(crate::node::AbsentKeys::field("direction"));
        data.direction = value;
        Ok(self)
    }
    /// Set text format and mark the element dirty.
    pub fn set_text_format(&mut self, value: TextFormat) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let BaseData::Element(data) = &mut self.tx.writable(self.key)?.base else {
            return Err(Error::NotAnElement(self.key));
        };
        data.absent
            .remove(crate::node::AbsentKeys::field("text_format"));
        data.text_format = value;
        Ok(self)
    }
    /// Set text style and mark the element dirty.
    pub fn set_text_style(&mut self, value: &str) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let BaseData::Element(data) = &mut self.tx.writable(self.key)?.base else {
            return Err(Error::NotAnElement(self.key));
        };
        data.absent
            .remove(crate::node::AbsentKeys::field("text_style"));
        data.text_style = Arc::from(value);
        Ok(self)
    }
    /// Select child boundaries, redirecting nonempty-required elements to descendants.
    pub fn select(
        &mut self,
        anchor: Option<ChildIndex>,
        focus: Option<ChildIndex>,
    ) -> Result<(), Error> {
        self.tx.guard_write()?;
        let end = ChildIndex(self.data().children_size());
        let a = anchor.unwrap_or(end);
        let f = focus.unwrap_or(end);
        if !self.tx.can_be_empty(self.key) && self.data().children_size() > 0 {
            let anchor = if a.0 == 0 {
                self.tx.start_point(self.key)?
            } else {
                self.tx.end_point(self.key)?
            };
            let focus = if f.0 == 0 {
                self.tx.start_point(self.key)?
            } else {
                self.tx.end_point(self.key)?
            };
            return self.tx.select_points(anchor, focus);
        }
        self.tx
            .select_points(Point::element(self.key, a), Point::element(self.key, f))
    }
}
impl TextMut<'_, '_> {
    /// Text identity.
    pub fn key(&self) -> NodeKey {
        self.key
    }
    /// Current text fields.
    pub fn data(&self) -> &TextData {
        static EMPTY: std::sync::LazyLock<TextData> = std::sync::LazyLock::new(TextData::default);
        self.tx.view().text(self.key).unwrap_or(&EMPTY)
    }
    fn data_mut(&mut self) -> Result<&mut TextData, Error> {
        self.tx.guard_write()?;
        match &mut self.tx.writable(self.key)?.base {
            BaseData::Text(data) => Ok(data),
            _ => Err(Error::NotAText(self.key)),
        }
    }
    /// Set content through the virtual coercion hook; equal content is a no-op.
    /// s2: TX-08
    pub fn set_text_content(&mut self, text: &str) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let slot = self
            .tx
            .view()
            .slot(self.key)
            .ok_or(Error::NodeNotFound(self.key))?;
        let value = (self
            .tx
            .pending
            .registry
            .vtable(slot.type_index)
            .coerce_text_content)(
            slot.data.as_any(),
            NodeView {
                key: self.key,
                state: self.tx.view(),
            },
            text,
        )?
        .into_owned();
        if self.data().text.as_str() != value
            || self.data().absent.contains(crate::node::AbsentKeys::TEXT)
        {
            self.data_mut()?.text = TextBuffer::new(value);
            self.data_mut()?
                .absent
                .remove(crate::node::AbsentKeys::TEXT);
        }
        Ok(self)
    }
    /// Set format through the node's coercion hook.
    pub fn set_format(&mut self, value: TextFormat) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let slot = self
            .tx
            .view()
            .slot(self.key)
            .ok_or(Error::NodeNotFound(self.key))?;
        let value = (self
            .tx
            .pending
            .registry
            .vtable(slot.type_index)
            .coerce_format)(
            slot.data.as_any(),
            NodeView {
                key: self.key,
                state: self.tx.view(),
            },
            value,
        )?;
        if let Some(value) = value
            && self.data().format != value
        {
            self.data_mut()?.format = value;
        }
        if value.is_some() {
            self.data_mut()?
                .absent
                .remove(crate::node::AbsentKeys::field("format"));
        }
        Ok(self)
    }
    /// Set detail through the node's coercion hook.
    pub fn set_detail(&mut self, value: TextDetail) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let slot = self
            .tx
            .view()
            .slot(self.key)
            .ok_or(Error::NodeNotFound(self.key))?;
        let value = (self
            .tx
            .pending
            .registry
            .vtable(slot.type_index)
            .coerce_detail)(
            slot.data.as_any(),
            NodeView {
                key: self.key,
                state: self.tx.view(),
            },
            value,
        )?;
        if let Some(value) = value
            && self.data().detail != value
        {
            self.data_mut()?.detail = value;
        }
        if value.is_some() {
            self.data_mut()?
                .absent
                .remove(crate::node::AbsentKeys::field("detail"));
        }
        Ok(self)
    }
    /// Set mode through the node's coercion hook.
    pub fn set_mode(&mut self, value: TextMode) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let slot = self
            .tx
            .view()
            .slot(self.key)
            .ok_or(Error::NodeNotFound(self.key))?;
        let value = (self.tx.pending.registry.vtable(slot.type_index).coerce_mode)(
            slot.data.as_any(),
            NodeView {
                key: self.key,
                state: self.tx.view(),
            },
            value,
        )?;
        if let Some(value) = value
            && (self.data().mode != value
                || self.data().absent.contains(crate::node::AbsentKeys::MODE))
        {
            self.data_mut()?.mode = value;
            self.data_mut()?
                .absent
                .remove(crate::node::AbsentKeys::MODE);
        }
        Ok(self)
    }
    /// Set a single format bitmask.
    pub fn set_format_type(&mut self, format: TextFormatType) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        self.set_format(format.flag())
    }
    /// Toggle a format, honoring exclusions.
    pub fn toggle_format(&mut self, format: TextFormatType) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        self.set_format(self.data().format.toggled(format, None))
    }
    /// Set text CSS.
    pub fn set_style(&mut self, style: &str) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        if self.data().style.as_ref() != style
            || self.data().absent.contains(crate::node::AbsentKeys::STYLE)
        {
            self.data_mut()?.style = Arc::from(style);
            self.data_mut()?
                .absent
                .remove(crate::node::AbsentKeys::STYLE);
        }
        Ok(self)
    }
    /// Toggle direction detection.
    pub fn toggle_directionless(&mut self) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        self.set_detail(self.data().detail ^ TextDetail::DIRECTIONLESS)
    }
    /// Toggle merge prevention.
    pub fn toggle_unmergeable(&mut self) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        self.set_detail(self.data().detail ^ TextDetail::UNMERGEABLE)
    }
    /// Splice valid UTF-16 boundaries, optionally collapsing selection after inserted text.
    /// s2: TX-09
    pub fn splice_text(
        &mut self,
        range: Range<Utf16Offset>,
        insert: &str,
        move_selection: bool,
    ) -> Result<&mut Self, Error> {
        self.tx.guard_write()?;
        let slot = self
            .tx
            .view()
            .slot(self.key)
            .ok_or(Error::NodeNotFound(self.key))?;
        let decision = (self
            .tx
            .pending
            .registry
            .vtable(slot.type_index)
            .check_splice_text)(
            slot.data.as_any(),
            NodeView {
                key: self.key,
                state: self.tx.view(),
            },
            range.clone(),
            insert,
        )?;
        if decision == SpliceText::Skip {
            return Ok(self);
        }
        let start = self.data().text.byte_offset(range.start)?;
        let end = self
            .data()
            .text
            .byte_offset(range.end.min(self.data().text.utf16_len()))?;
        if start > end {
            return Err(Error::Utf16OffsetOutOfRange(range.end));
        }
        let mut value = self.data().text.as_str().to_owned();
        value.replace_range(start..end, insert);
        self.set_text_content(&value)?;
        if move_selection {
            let offset = range.start + TextBuffer::new(insert).utf16_len();
            self.select(Some(offset), Some(offset))?;
        }
        Ok(self)
    }
    /// Select UTF-16 positions in this text node.
    pub fn select(
        &mut self,
        anchor: Option<Utf16Offset>,
        focus: Option<Utf16Offset>,
    ) -> Result<(), Error> {
        self.tx.guard_write()?;
        let end = self.data().text.utf16_len();
        let anchor = anchor.unwrap_or(end);
        let focus = focus.unwrap_or(end);
        self.data().text.byte_offset(anchor)?;
        self.data().text.byte_offset(focus)?;
        self.tx
            .select_points(Point::text(self.key, anchor), Point::text(self.key, focus))
    }
    /// Split into plain text nodes, retaining text properties and state but not mode.
    /// s2: TX-05
    pub fn split_text(&mut self, offsets: &[Utf16Offset]) -> Result<Vec<NodeKey>, Error> {
        self.tx.guard_write()?;
        let data = self.data().clone();
        if data.text.as_str().is_empty() {
            return Ok(vec![]);
        }
        let mut offsets: Vec<_> = offsets
            .iter()
            .copied()
            .filter(|o| *o > Utf16Offset::ZERO && *o < data.text.utf16_len())
            .collect();
        offsets.sort();
        offsets.dedup();
        for offset in &offsets {
            data.text.byte_offset(*offset)?;
        }
        if offsets.is_empty() {
            return Ok(vec![self.key]);
        }
        let original = self.key;
        let state = self
            .tx
            .view()
            .slot(original)
            .ok_or(Error::NodeNotFound(original))?
            .state
            .clone();
        let mut bounds = vec![Utf16Offset::ZERO];
        bounds.extend(offsets);
        bounds.push(data.text.utf16_len());
        let mut parts = vec![];
        for (i, bounds) in bounds.windows(2).enumerate() {
            let start = *bounds.first().ok_or(Error::Invariant("split bound"))?;
            let end = *bounds.get(1).ok_or(Error::Invariant("split bound"))?;
            let text = data.text.slice(start..end)?;
            let part = if i == 0 && !data.is_segmented() {
                self.set_text_content(text)?;
                original
            } else {
                let part = self.tx.create_text(text)?.key();
                let mut target = self.tx.text(part)?;
                target
                    .set_format(data.format)?
                    .set_style(&data.style)?
                    .set_detail(data.detail)?;
                self.tx.writable(part)?.state = state.clone();
                if i == 0 {
                    self.tx.replace(original, part, false)?;
                } else {
                    self.tx.insert_after(
                        *parts
                            .last()
                            .ok_or(Error::Invariant("missing split predecessor"))?,
                        part,
                        true,
                    )?;
                }
                part
            };
            parts.push(part);
        }
        let map_point = |point: &mut Point| -> Result<(), Error> {
            if let Point::Text { key, offset } = point
                && *key == original
            {
                let i = bounds
                    .windows(2)
                    .position(|window| window.get(1).is_some_and(|end| *offset <= *end))
                    .unwrap_or(parts.len() - 1);
                let start = *bounds.get(i).ok_or(Error::Invariant("split point bound"))?;
                *key = *parts.get(i).ok_or(Error::Invariant("split point node"))?;
                *offset = *offset - start;
            }
            Ok(())
        };
        if let Some(Selection::Range(range)) = &mut self.tx.pending.selection {
            map_point(&mut range.anchor)?;
            map_point(&mut range.focus)?;
        }
        Ok(parts)
    }
    /// Merge adjacent text siblings into this node, preserving text order.
    pub fn merge_with_sibling(&mut self, target: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.tx.guard_write()?;
        let target = target.into();
        let before = self.tx.prev_sibling(self.key) == Some(target);
        let after = self.tx.next_sibling(self.key) == Some(target);
        if !before && !after {
            return Err(Error::MergeWithNonSibling);
        }
        let other = self
            .tx
            .view()
            .text(target)
            .ok_or(Error::NotAText(target))?
            .text
            .as_str()
            .to_owned();
        let own = self.data().text.as_str();
        let text = if before {
            format!("{other}{own}")
        } else {
            format!("{own}{other}")
        };
        let own_len = self.data().text.utf16_len();
        let other_len = TextBuffer::new(&other).utf16_len();
        self.set_text_content(&text)?;
        if let Some(Selection::Range(range)) = &mut self.tx.pending.selection {
            for point in [&mut range.anchor, &mut range.focus] {
                if let Point::Text { key, offset } = point {
                    if *key == target {
                        *key = self.key;
                        if !before {
                            *offset = *offset + own_len;
                        }
                    } else if *key == self.key && before {
                        *offset = *offset + other_len;
                    }
                }
            }
        }
        if self.tx.composition_key == Some(target) {
            self.tx.composition_key = Some(self.key);
        }
        self.tx.remove(target, false)?;
        Ok(self.key)
    }
}
