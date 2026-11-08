//! Model policy for browser text and composition inputs.
use super::*;
impl ViewHost {
    /// Whether the host is iOS.
    pub fn is_ios(self) -> bool {
        self.os == ViewOs::Ios
    }
    /// Whether the host is Android.
    pub fn is_android(self) -> bool {
        self.os == ViewOs::Android
    }
    /// Whether Apple keyboard behavior applies.
    pub fn is_apple(self) -> bool {
        matches!(self.os, ViewOs::Apple | ViewOs::Ios)
    }
    fn composition_chars(self) -> Option<(&'static str, &'static str)> {
        match self.engine {
            ViewEngine::Native => None,
            ViewEngine::Firefox => Some(("\u{200b}", "\u{a0}")),
            ViewEngine::AppleWebKit => Some(("\u{a0}", "\u{a0}")),
            ViewEngine::Chromium => {
                if self.is_ios() {
                    Some(("\u{a0}", "\u{a0}"))
                } else {
                    Some(("\u{200b}", "\u{200b}"))
                }
            }
        }
    }
}
impl<'state> StateRef<'state> {
    /// The model half of the host insertion prevention predicate.
    /// s2: EVT-14, EVT-15
    pub fn should_prevent_default_and_insert_text(
        self,
        selection: &RangeSelection,
        text: &str,
        facts: InsertTextFacts,
    ) -> Result<bool, Error> {
        self.insertion_policy(selection, text, facts, false)
    }
    pub(super) fn insertion_policy(
        self,
        selection: &RangeSelection,
        text: &str,
        facts: InsertTextFacts,
        dirty: bool,
    ) -> Result<bool, Error> {
        let anchor = selection.anchor;
        let focus = selection.focus;
        let key = anchor.node(self)?;
        let Some(data) = self.text(key) else {
            return Ok(true);
        };
        let length = text.encode_utf16().count();
        let composing = self.composition_key == Some(key);
        let parent = self.parent_or_err(key)?;
        let before = anchor.offset() == 0
            && (!self.can_insert_text_before(key)
                || (!self.can_insert_text_before(parent) && !composing)
                || self.is_token_or_tab(key)
                || self.prev_sibling(key).is_some_and(|prev| {
                    (self.is_text(prev) || (self.is_element(prev) && self.is_inline(prev)))
                        && !self.can_insert_text_after(prev)
                }));
        let after = anchor.offset() == data.text.utf16_len().0
            && (!self.can_insert_text_after(key)
                || (!self.can_insert_text_after(parent) && !composing)
                || self.is_token_or_tab(key));
        Ok(anchor.key() != focus.key()
            || ((facts.dangling_input
                || (dirty && length < 2)
                || text.chars().any(|ch| ch.len_utf16() == 2))
                && anchor.offset() != focus.offset()
                && !composing)
            || matches!(data.mode, TextMode::Token | TextMode::Segmented)
            || (dirty && length > 1)
            || (facts.dom_anchor_not_backing_text && !composing)
            || facts.target_range_mismatch
            || (!composing && (data.format != selection.format || data.style != selection.style))
            || (selection.is_collapsed() && (before || after)))
    }
    /// Whether a deletion may cross the two node boundaries.
    /// s2: EVT-28
    pub fn can_remove_text(self, anchor: impl Into<NodeKey>, focus: impl Into<NodeKey>) -> bool {
        let anchor = anchor.into();
        let focus = focus.into();
        anchor != focus
            || self.is_element(anchor)
            || self.is_element(focus)
            || !self.is_token_or_tab(anchor)
            || !self.is_token_or_tab(focus)
    }
}
impl Transaction<'_> {
    /// Insertion prevention, including pending dirty marks.
    pub fn should_prevent_default_and_insert_text(
        &self,
        selection: &RangeSelection,
        text: &str,
        facts: InsertTextFacts,
    ) -> Result<bool, Error> {
        self.view().insertion_policy(
            selection,
            text,
            facts,
            self.is_dirty_leaf(selection.anchor.key()),
        )
    }
    /// Advance across an already present acceptance character after a multi-character insertion.
    /// s2: EVT-25
    pub fn move_selection_past_trailing_acceptance_boundary(
        &mut self,
        inserted: &str,
        last_key: Option<&str>,
    ) -> Result<(), Error> {
        if inserted.encode_utf16().count() <= 1 {
            return Ok(());
        }
        let character = match last_key {
            Some("Enter") => "\n",
            Some("Tab") => "\t",
            Some(key) if key.encode_utf16().count() == 1 => key,
            _ => return Ok(()),
        };
        let Some(range) = self
            .selection()
            .and_then(Selection::as_range)
            .filter(|range| range.is_collapsed())
            .cloned()
        else {
            return Ok(());
        };
        let Point::Text { key, offset } = range.anchor else {
            return Ok(());
        };
        let size = self.text_content_size(key);
        if offset == size {
            let next = self.next_sibling(key);
            if character == "\n" {
                if let Some(next) = next.filter(|next| self.is_line_break(*next)) {
                    self.select_end(next)?;
                } else if next.is_none()
                    && let Some(block) =
                        self.find_matching_parent(key, |view, key| view.is_block(key))
                    && let Some(next) = self.next_sibling(block).filter(|key| self.is_element(*key))
                {
                    self.select_start(next)?;
                }
            } else if let Some(next) = next {
                if character == "\t" && self.is::<Tab>(next) {
                    self.select_end(next)?;
                } else if self.is_text(next) && self.text_content(next).starts_with(character) {
                    self.set_text_node_range(next, Utf16Offset(1), next, Utf16Offset(1))?;
                }
            }
        } else {
            let text = &self.view().text_data(key)?.text;
            let index = text.byte_offset(offset)?;
            if text
                .as_str()
                .get(index..)
                .is_some_and(|text| text.starts_with(character))
            {
                self.set_text_node_range(
                    key,
                    offset + Utf16Offset(1),
                    key,
                    offset + Utf16Offset(1),
                )?;
            }
        }
        Ok(())
    }
}
pub(super) fn from_view(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    text: &str,
    offsets: (Option<Utf16Offset>, Option<Utf16Offset>),
    end: bool,
    data: Option<&str>,
    effects: &mut Vec<Effect>,
) -> Result<(), Error> {
    let (mut anchor, mut focus) = offsets;
    tx.view().text_data(key)?;
    if !tx.is_attached(key) || (!end && tx.is_dirty_leaf(key)) {
        return Ok(());
    }
    let composing = tx.composition_key() == Some(key);
    let mut normalized = text.to_owned();
    if let Some((suffix, start)) = tx.view_host().composition_chars() {
        if !data.unwrap_or("").is_empty() && (text == suffix || text == start) {
            normalized = data.unwrap_or("").to_owned();
            let offset = Utf16Offset(normalized.encode_utf16().count() as u32);
            anchor = Some(offset);
            focus = Some(offset);
        }
        if composing || end {
            if normalized.ends_with(suffix) {
                normalized.truncate(normalized.len() - suffix.len());
            }
            if end {
                while let Some(index) = normalized.find(start) {
                    let units = normalized
                        .get(..index)
                        .ok_or(Error::Invariant("composition prefix"))?
                        .encode_utf16()
                        .count() as u32;
                    normalized.replace_range(index..index + start.len(), "");
                    for offset in [&mut anchor, &mut focus].into_iter().flatten() {
                        if offset.0 > units {
                            offset.0 = offset.0.saturating_sub(1).max(units);
                        }
                    }
                }
            }
        }
    }
    let old = tx.view().text_data(key)?.clone();
    if !end && old.text.as_str() == normalized {
        return Ok(());
    }
    if normalized.is_empty() {
        tx.set_composition_key(None)?;
        if matches!(
            tx.view_host().engine,
            ViewEngine::Chromium | ViewEngine::Firefox
        ) && !tx.view_host().is_ios()
        {
            effects.push(Effect::ScheduleRemoveEmptyText { key, delay_ms: 20 });
        } else {
            tx.remove(key, false)?;
        }
        return Ok(());
    }
    let previous = tx.previous_selection().and_then(Selection::as_range);
    let forbidden = previous.is_some_and(|range| {
        tx.parent(key)
            .is_some_and(|parent| !tx.can_insert_text_before(parent) && range.anchor.offset() == 0)
            || (range.anchor.key() == key
                && range.anchor.offset() == 0
                && !tx.can_insert_text_before(key)
                && !composing)
            || (range.focus.key() == key
                && range.focus.offset() == old.text.utf16_len().0
                && !tx.can_insert_text_after(key)
                && !composing)
    });
    if old.mode == TextMode::Token || forbidden {
        tx.mark_dirty(key)?;
        return Ok(());
    }
    let mut node = key;
    let offsets = anchor
        .zip(focus)
        .filter(|_| tx.selection().is_some_and(Selection::is_range));
    if offsets.is_some() && old.mode == TextMode::Segmented {
        node = tx.create_text(old.text.as_str())?.key();
        tx.replace(key, node, false)?;
    }
    tx.text(node)?.set_text_content(&normalized)?;
    let buffer = &tx.view().text_data(node)?.text;
    if let Some((a, b)) = offsets {
        let a = a.min(buffer.utf16_len());
        let b = b.min(buffer.utf16_len());
        buffer.byte_offset(a)?;
        buffer.byte_offset(b)?;
        tx.set_text_node_range(node, a, node, b)?;
    } else if let Some(mut range) = tx.selection().and_then(Selection::as_range).cloned() {
        for point in [&mut range.anchor, &mut range.focus] {
            if let Point::Text {
                key: point_key,
                offset,
            } = point
                && *point_key == node
            {
                *offset = (*offset).min(buffer.utf16_len());
                buffer.byte_offset(*offset)?;
            }
        }
        range.invalidate_changed_direction();
        tx.set_selection(Some(Selection::Range(range)))?;
    }
    Ok(())
}
pub(super) fn composition(
    tx: &mut Transaction<'_>,
    event: &CompositionEvent,
    effects: &mut Vec<Effect>,
) -> Result<Handled, Error> {
    match event {
        CompositionEvent::Start { data: _ } => {
            if tx.composition_key().is_none()
                && let Some(range) = tx.selection().and_then(Selection::as_range).cloned()
            {
                tx.add_tag(UpdateTag::CompositionStart);
                tx.set_composition_key(Some(range.anchor.key()))?;
                if (!matches!(range.anchor, Point::Text { .. })
                    || !range.is_collapsed()
                    || tx.view().text(range.anchor.key()).is_some_and(|node| {
                        node.format != range.format || node.style != range.style
                    }))
                    && let Some((_, start)) = tx.view_host().composition_chars()
                {
                    tx.dispatch_inner(&Command::InsertText(start.into()), true)?;
                }
            }
        }
        CompositionEvent::End {
            key,
            text,
            anchor,
            focus,
            data,
        } => {
            tx.set_composition_key(None)?;
            tx.add_tag(UpdateTag::CompositionEnd);
            if data.ends_with('\n') {
                if let Some(range) = tx.selection().and_then(Selection::as_range) {
                    let focus = range.focus;
                    tx.set_point(PointRole::Anchor, focus)?;
                }
                tx.dispatch_inner(
                    &Command::Key {
                        command: KeyCommand::Enter,
                        event: None,
                    },
                    true,
                )?;
            } else {
                from_view(tx, *key, text, (*anchor, *focus), true, Some(data), effects)?;
            }
        }
    }
    Ok(Handled::Yes)
}
