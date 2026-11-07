//! Sans-IO markdown shortcuts. Drop a false follow-up; commit true with HistoryPush.
use crate::matcher::Match;
use crate::{import::text::can_contain_transformable_markdown, util::*, *};
use lexical_model::*;
use lexical_rich_nodes::code::CodeNode;

/// Committed insertion facts. Collections borrow the model's ordered commit sets.
pub struct ShortcutTrigger<'a> {
    /// Update tags of the insertion commit.
    pub tags: &'a TagSet,
    /// Host composition state after the insertion.
    pub is_composing: bool,
    /// Selection before insertion.
    pub prev_selection: Option<&'a Selection>,
    /// Selection after insertion.
    pub selection: Option<&'a Selection>,
    /// Leaves dirtied by the insertion.
    pub dirty_leaves: &'a DirtyLeaves,
}
impl<'a> ShortcutTrigger<'a> {
    /// Borrow insertion facts without allocating or consulting a host runtime.
    pub fn from_commit(commit: &'a Commit, is_composing: bool) -> Self {
        Self {
            tags: &commit.tags,
            is_composing,
            prev_selection: commit.prev.selection(),
            selection: commit.next.selection(),
            dirty_leaves: &commit.changes.dirty_leaves,
        }
    }
}
/// Cheap committed-state precheck, without opening a follow-up transaction.
pub fn markdown_shortcut_anchor(
    state: &impl Read,
    trigger: &ShortcutTrigger<'_>,
    transformers: &Transformers,
) -> Option<(NodeKey, Utf16Offset)> {
    anchor(state.view(), trigger, transformers)
}
fn anchor(
    state: StateRef<'_>,
    trigger: &ShortcutTrigger<'_>,
    transformers: &Transformers,
) -> Option<(NodeKey, Utf16Offset)> {
    if trigger.tags.contains(&UpdateTag::Collaboration)
        || trigger.tags.contains(&UpdateTag::Historic)
        || trigger.is_composing
    {
        return None;
    }
    let composition_end = trigger.tags.contains(&UpdateTag::CompositionEnd);
    let (Some(Selection::Range(previous)), Some(Selection::Range(selection))) =
        (trigger.prev_selection, trigger.selection)
    else {
        return None;
    };
    if !selection.is_collapsed() || (!composition_end && selection == previous) {
        return None;
    }
    let point = selection.anchor;
    if !state.is_text(point.key())
        || !trigger.dirty_leaves.contains(&point.key())
        || (!composition_end
            && point.offset() != 1
            && u64::from(point.offset()) > u64::from(previous.anchor.offset()) + 1)
    {
        return None;
    }
    if composition_end {
        let units: Vec<_> = state.text_content(point.key()).encode_utf16().collect();
        let last = point
            .offset()
            .checked_sub(1)
            .and_then(|i| units.get(i as usize))?;
        if !transformers.composition_end_triggers().contains(last) {
            return None;
        }
    }
    Some((point.key(), Utf16Offset(point.offset())))
}
/// Run the post-insertion shortcut pass. Only commit a true result, with HistoryPush.
/// A false result may contain declined-transform splits; dropping the transaction
/// discards them and never enters the editor's follow-up/cascade machinery.
#[tracing::instrument(level = "debug", skip_all, err)]
pub fn markdown_shortcuts(
    tx: &mut Transaction<'_>,
    trigger: &ShortcutTrigger<'_>,
    transformers: &Transformers,
    opts: &MarkdownOptions,
) -> Result<bool> {
    opts.validate()?;
    let Some((node, offset)) = anchor(tx.view(), trigger, transformers) else {
        return Ok(false);
    };
    let Some(parent) = eligible(tx.view(), node) else {
        return Ok(false);
    };
    if run_elements(
        tx,
        parent,
        node,
        offset,
        transformers.element().iter().map(AsRef::as_ref),
        opts,
        false,
    )? || run_multiline(tx, parent, node, offset, transformers, opts, false)?
        || run_matches(tx, node, offset, transformers)?
    {
        return Ok(true);
    }
    run_formats(tx, node, offset, transformers)
}
/// Low-priority Enter handler. A true result asks the host to preventDefault.
#[tracing::instrument(level = "debug", skip_all, err)]
pub fn markdown_shortcuts_on_enter(
    tx: &mut Transaction<'_>,
    shift_key: bool,
    transformers: &Transformers,
    opts: &MarkdownOptions,
) -> Result<bool> {
    opts.validate()?;
    if shift_key {
        return Ok(false);
    }
    let Some(Selection::Range(selection)) = tx.selection() else {
        return Ok(false);
    };
    if !selection.is_collapsed() {
        return Ok(false);
    }
    let point = selection.anchor;
    let Some(parent) = eligible(tx.view(), point.key()) else {
        return Ok(false);
    };
    if point.offset() != tx.text_content_size(point.key()).get() {
        return Ok(false);
    }
    let offset = Utf16Offset(point.offset());
    if run_multiline(tx, parent, point.key(), offset, transformers, opts, true)? {
        return Ok(true);
    }
    run_elements(
        tx,
        parent,
        point.key(),
        offset,
        transformers.element_for_enter().map(AsRef::as_ref),
        opts,
        true,
    )
}
fn eligible(st: StateRef<'_>, node: NodeKey) -> Option<NodeKey> {
    if !can_contain_transformable_markdown(st, node) {
        return None;
    }
    st.parent(node).filter(|p| !st.is::<CodeNode>(*p))
}
fn block_gate(
    st: StateRef<'_>,
    parent: NodeKey,
    node: NodeKey,
    offset: Utf16Offset,
    enter: bool,
) -> bool {
    st.parent(parent)
        .is_some_and(|p| st.is_root_or_shadow_root(p))
        && st.first_child(parent) == Some(node)
        && (enter
            || offset
                .get()
                .checked_sub(1)
                .and_then(|i| st.text_content(node).encode_utf16().nth(i as usize))
                == Some(32))
}
fn matches_offset(m: &Match, offset: Utf16Offset, enter: bool) -> bool {
    let expected = if enter || m.full().ends_with(' ') {
        Some(offset.get())
    } else {
        offset.get().checked_sub(1)
    };
    expected == Some(m.full_len16())
}
fn split_block(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    offset: Utf16Offset,
) -> Result<(NodeKey, Vec<NodeKey>)> {
    let next: Vec<_> = tx.next_siblings(node).collect();
    let parts = tx.text(node)?.split_text(&[offset])?;
    let leading = parts[0];
    let siblings = parts.into_iter().skip(1).chain(next).collect();
    Ok((leading, siblings))
}
fn run_elements<'a>(
    tx: &mut Transaction<'_>,
    parent: NodeKey,
    node: NodeKey,
    offset: Utf16Offset,
    elements: impl Iterator<Item = &'a (dyn ElementTransformer + 'static)>,
    opts: &MarkdownOptions,
    enter: bool,
) -> Result<bool> {
    if !block_gate(tx.view(), parent, node, offset, enter) {
        return Ok(false);
    }
    let text = tx.text_content(node).into_owned();
    for t in elements {
        if let Some(m) = t
            .reg_exp()
            .exec(&text)
            .filter(|m| matches_offset(m, offset, enter))
        {
            let (leading, siblings) = split_block(tx, node, offset)?;
            if t.replace(tx, opts, parent, &siblings, &m, false)? == ReplaceResult::Handled {
                tx.remove(leading, false)?;
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn run_multiline(
    tx: &mut Transaction<'_>,
    parent: NodeKey,
    node: NodeKey,
    offset: Utf16Offset,
    transformers: &Transformers,
    opts: &MarkdownOptions,
    enter: bool,
) -> Result<bool> {
    if !block_gate(tx.view(), parent, node, offset, enter) {
        return Ok(false);
    }
    let text = tx.text_content(node).into_owned();
    for t in transformers.multiline_element() {
        if matches!(t.reg_exp_end(), RegExpEnd::Required(_)) {
            continue;
        }
        if let Some(m) = t
            .reg_exp_start()
            .exec(&text)
            .filter(|m| matches_offset(m, offset, enter))
        {
            let (leading, siblings) = split_block(tx, node, offset)?;
            if t.replace(tx, opts, parent, Some(&siblings), &m, None, None, false)?
                == ReplaceResult::Handled
            {
                tx.remove(leading, false)?;
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn run_matches(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    offset: Utf16Offset,
    transformers: &Transformers,
) -> Result<bool> {
    let text = tx.text_content(node).into_owned();
    let units: Vec<_> = text.encode_utf16().collect();
    let Some(last) = offset
        .get()
        .checked_sub(1)
        .and_then(|i| units.get(i as usize))
    else {
        return Ok(false);
    };
    let prefix = slice(&text, 0, (offset.get() as usize).min(units.len()));
    for t in transformers.matches_for_trigger(*last) {
        if !t.has_replace() {
            continue;
        }
        if let Some(m) = t.reg_exp().exec(&prefix) {
            let parts = crate::import::text::split(
                tx,
                node,
                m.index.get() as usize,
                m.end().get() as usize,
            )?;
            let replace = parts
                .transformed
                .ok_or(crate::Error::InvalidArgument("shortcut split"))?;
            tx.select_next(replace, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
            t.replace(tx, replace, &m)?;
            return Ok(true);
        }
    }
    Ok(false)
}
fn open_start(text: &[u16], max: usize, tag: &[u16]) -> Option<usize> {
    if tag.is_empty() {
        return None;
    }
    (tag.len()..=max).rev().map(|i| i - tag.len()).find(|i| {
        text.get(*i..*i + tag.len()) == Some(tag) && text.get(*i + tag.len()) != Some(&32)
    })
}
fn run_formats(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    offset: Utf16Offset,
    transformers: &Transformers,
) -> Result<bool> {
    let text = tx.text_content(node).into_owned();
    let units: Vec<_> = text.encode_utf16().collect();
    let Some(close_end) = (offset.get() as usize)
        .checked_sub(1)
        .filter(|i| *i < units.len())
    else {
        return Ok(false);
    };
    let close_char = units[close_end];
    for t in transformers.formats_for_trigger(close_char) {
        let tag: Vec<_> = t.tag.encode_utf16().collect();
        let Some(close_start) = (close_end + 1).checked_sub(tag.len()) else {
            continue;
        };
        if tag.len() > 1 && units.get(close_start..close_end + 1) != Some(&tag) {
            continue;
        }
        if close_start.checked_sub(1).and_then(|i| units.get(i)) == Some(&32) {
            continue;
        }
        if !t.intraword
            && units
                .get(close_end + 1)
                .is_some_and(|c| !is_punctuation_or_space(*c))
        {
            continue;
        }
        let mut open_node = node;
        let mut open_units = units.clone();
        let mut opening = open_start(&open_units, close_start, &tag);
        let mut sibling = tx.prev_sibling(node);
        while opening.is_none() {
            let Some(key) = sibling else {
                break;
            };
            sibling = tx.prev_sibling(key);
            if tx.is::<LineBreak>(key) {
                break;
            }
            if tx.is_text(key) && !tx.text_data(key)?.format.contains(TextFormat::CODE) {
                open_node = key;
                open_units = tx.text_content(key).encode_utf16().collect();
                opening = open_start(&open_units, open_units.len(), &tag);
            }
        }
        let Some(opening) = opening else {
            continue;
        };
        if open_node == node && opening + tag.len() == close_start {
            continue;
        }
        if opening.checked_sub(1).and_then(|i| open_units.get(i)) == Some(&close_char) {
            continue;
        }
        if !t.intraword
            && opening
                .checked_sub(1)
                .and_then(|i| open_units.get(i))
                .is_some_and(|c| !is_punctuation_or_space(*c))
        {
            continue;
        }
        if !t.format.contains(&TextFormatType::Code)
            && open_units[..opening].iter().filter(|c| **c == 96).count() % 2 != 0
        {
            continue;
        }
        let closed = [
            units[..close_start].to_vec(),
            units[close_end + 1..].to_vec(),
        ]
        .concat();
        tx.text(node)?
            .set_text_content(&String::from_utf16_lossy(&closed))?;
        let source = if open_node == node {
            &closed
        } else {
            &open_units
        };
        let opened = [
            source[..opening].to_vec(),
            source[opening + tag.len()..].to_vec(),
        ]
        .concat();
        tx.text(open_node)?
            .set_text_content(&String::from_utf16_lossy(&opened))?;
        let previous_format = tx.selection().and_then(|s| {
            if let Selection::Range(r) = s {
                Some(r.format)
            } else {
                None
            }
        });
        let new_offset = close_end + 1 - tag.len() * if open_node == node { 2 } else { 1 };
        tx.replace_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(open_node, Utf16Offset(opening as u32)),
            Point::text(node, Utf16Offset(new_offset as u32)),
        ))))?;
        for format in t.format.iter() {
            if !tx.range_selection()?.has_format(*format) {
                tx.format_text(*format, None)?;
            }
        }
        let mut next = tx.range_selection()?.clone();
        next.anchor = next.focus;
        for format in t.format.iter() {
            if next.has_format(*format) {
                next.toggle_format(*format);
            }
        }
        if let Some(format) = previous_format {
            next.set_format(format);
        }
        tx.set_selection(Some(Selection::Range(next)))?;
        return Ok(true);
    }
    Ok(false)
}
#[cfg(test)]
mod test;
