//! Code indentation and keyboard decisions, independent of DOM events.
use super::*;
use lexical_model::*;
/// Command to dispatch through the host's priority-ordered command bus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabAction {
    /// Insert a literal tab at the selection.
    InsertTab,
    /// Indent the selected lines.
    Indent,
    /// Remove one indentation level.
    Outdent,
}
/// Optional space-indentation support.
#[derive(Clone, Copy, Debug, Default)]
pub struct CodeIndentOptions {
    /// Maximum leading spaces removed by Outdent, in addition to tabs.
    pub tab_size: Option<u32>,
}
/// Both range endpoints belong directly to the same code block.
pub fn is_selection_in_code(state: &impl Read, selection: Option<&Selection>) -> bool {
    let Some(Selection::Range(range)) = selection else {
        return false;
    };
    let code = |key| {
        if is_code_node(state, key) {
            Some(key)
        } else {
            state.parent(key)
        }
    };
    code(range.anchor.key())
        .is_some_and(|key| is_code_node(state, key) && Some(key) == code(range.focus.key()))
}
fn code_lines(state: StateRef<'_>, range: &RangeSelection) -> Result<Vec<Vec<NodeKey>>, Error> {
    let nodes = range.nodes(state)?;
    if nodes.len() == 1 && nodes.first().is_some_and(|key| is_code_node(&state, *key)) {
        return Ok(Vec::new());
    }
    let mut lines = Vec::new();
    let mut line = Vec::new();
    for node in nodes {
        if !is_code_line_node(&state, node) && !state.is_line_break(node) {
            return Err(Error::Invariant(
                "Expected selection to be inside CodeBlock and consisting of CodeHighlightNode, TabNode and LineBreakNode",
            ));
        }
        if state.is_line_break(node) {
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
        } else {
            line.push(node);
        }
    }
    let end = if range.is_backward(state)? {
        range.anchor
    } else {
        range.focus
    };
    if line
        .first()
        .is_some_and(|key| end != Point::text(*key, Utf16Offset::ZERO))
    {
        lines.push(line);
    }
    Ok(lines)
}
/// Choose the command for Tab; no mutation or nested command dispatch occurs here.
pub fn handle_tab(state: StateRef<'_>, shift: bool) -> Result<Option<TabAction>, Error> {
    if !is_selection_in_code(&state, state.selection()) {
        return Ok(None);
    }
    let Some(Selection::Range(range)) = state.selection() else {
        return Ok(None);
    };
    if shift {
        return Ok(Some(TabAction::Outdent));
    }
    if range.is_collapsed() {
        return Ok(Some(TabAction::InsertTab));
    }
    let lines = code_lines(state, range)?;
    let Some(line) = lines.first().filter(|_| lines.len() == 1) else {
        return Ok(Some(TabAction::Indent));
    };
    let first = *line.first().ok_or(Error::Invariant("code line is empty"))?;
    let start = Point::text(first_code_node_of_line(&state, first), Utf16Offset::ZERO);
    let last = last_code_node_of_line(&state, first);
    let end = Point::text(last, state.text_content_size(last));
    let (a, b) = if range.is_backward(state)? {
        (range.focus, range.anchor)
    } else {
        (range.anchor, range.focus)
    };
    let action = if a.is_before(state, &start)? || end.is_before(state, &b)? {
        TabAction::Indent
    } else if start.is_before(state, &a)? || b.is_before(state, &end)? {
        TabAction::InsertTab
    } else {
        TabAction::Indent
    };
    Ok(Some(action))
}
/// Keyboard adapter decision; dispatch the returned action through the command bus.
pub fn handle_key_tab(state: StateRef<'_>, shift: bool) -> Result<Option<TabAction>, Error> {
    handle_tab(state, shift)
}
/// Insert a tab only when the active selection is in code.
pub fn insert_tab_in_code(tx: &mut Transaction<'_>) -> Result<bool, Error> {
    if !is_selection_in_code(tx, tx.selection()) {
        return Ok(false);
    }
    let tab = tx.create(Tab {})?;
    tx.insert_nodes(&[tab.key()])?;
    Ok(true)
}
/// Indent or outdent the nonempty selected lines.
pub fn handle_multiline_indent(
    tx: &mut Transaction<'_>,
    action: TabAction,
    options: CodeIndentOptions,
) -> Result<bool, Error> {
    if !is_selection_in_code(tx, tx.selection()) {
        return Ok(false);
    }
    let range = tx.range_selection()?.clone();
    let lines = code_lines(tx.view(), &range)?;
    if lines.is_empty() && range.is_collapsed() {
        if action == TabAction::Indent {
            insert_tab_in_code(tx)?;
        }
        return Ok(true);
    }
    if lines.is_empty() && action == TabAction::Indent && range.text_content(tx.view())? == "\n" {
        let backward = range.is_backward(tx.view())?;
        let tab = tx.create(Tab {})?;
        let line = tx.create(LineBreak {})?;
        tx.insert_nodes(&[tab.key(), line.key()])?;
        let start = TextPointCaret::new(
            tx.view(),
            tab.key(),
            CaretDirection::Next,
            TextOffsetSpec::At(Utf16Offset::ZERO),
        )?;
        let end = normalize_caret(
            tx.view(),
            SiblingCaret::new(line.key(), CaretDirection::Next).into(),
        )?;
        let range = CaretRange::new(start.into(), end)?.in_direction(
            tx.view(),
            if backward {
                CaretDirection::Previous
            } else {
                CaretDirection::Next
            },
        );
        tx.set_selection_from_caret_range(range)?;
        return Ok(true);
    }
    for (index, line) in lines.iter().enumerate() {
        let Some(first) = line.first().copied() else {
            continue;
        };
        let first = if index == 0 {
            first_code_node_of_line(tx, first)
        } else {
            first
        };
        if action == TabAction::Indent {
            let tab = tx.create(Tab {})?;
            tx.insert_before(first, tab, true)?;
            if index == 0 {
                let range = tx.range_selection()?;
                let role = if range.is_backward(tx.view())? {
                    PointRole::Focus
                } else {
                    PointRole::Anchor
                };
                let point = if role == PointRole::Anchor {
                    range.anchor
                } else {
                    range.focus
                };
                if point == Point::text(first, Utf16Offset::ZERO) {
                    tx.set_point(role, Point::text(tab, Utf16Offset::ZERO))?;
                }
            }
        } else if tx.is::<Tab>(first) {
            tx.remove(first, false)?;
        } else if let Some(size) = options.tab_size.filter(|_| is_code_text(tx, first)) {
            outdent_leading_spaces(tx, first, size)?;
        }
    }
    Ok(true)
}
/// Move selected lines with Alt+arrows, preserving their text endpoints.
pub fn handle_arrow(tx: &mut Transaction<'_>, up: bool, alt: bool) -> Result<bool, Error> {
    if !is_selection_in_code(tx, tx.selection()) {
        return Ok(false);
    }
    let range = tx.range_selection()?.clone();
    let a = range.anchor.key();
    let f = range.focus.key();
    let adjacent = |tx: &Transaction<'_>, key| {
        if up {
            tx.prev_sibling(key)
        } else {
            tx.next_sibling(key)
        }
    };
    if range.is_collapsed()
        && range.anchor.offset() == if up { 0 } else { tx.text_content_size(a).get() }
        && adjacent(tx, a).is_none()
        && tx.parent(a).is_some_and(|key| is_code_node(tx, key))
    {
        return Ok(true);
    }
    if !is_code_line_node(tx, a) || !is_code_line_node(tx, f) {
        return Ok(false);
    }
    if !alt {
        return Ok(false);
    }
    let (first, last) = if range.anchor.is_before(tx.view(), &range.focus)? {
        (a, f)
    } else {
        (f, a)
    };
    let start = first_code_node_of_line(tx, first);
    let end = last_code_node_of_line(tx, last);
    let nodes = tx.nodes_between(start, end)?;
    if nodes
        .iter()
        .any(|key| !is_code_line_node(tx, *key) && !tx.is_line_break(*key))
    {
        return Ok(false);
    }
    let Some(line) =
        adjacent(tx, if up { start } else { end }).filter(|key| tx.is_line_break(*key))
    else {
        return Ok(true);
    };
    let Some(sibling) = adjacent(tx, line) else {
        return Ok(true);
    };
    let insertion = if up {
        first_code_node_of_line(tx, sibling)
    } else {
        last_code_node_of_line(tx, sibling)
    };
    tx.remove(line, false)?;
    for node in &nodes {
        tx.remove(*node, false)?;
    }
    if up {
        for node in nodes {
            tx.insert_before(insertion, node, false)?;
        }
        tx.insert_before(insertion, line, false)?;
    } else {
        tx.insert_after(insertion, line, false)?;
        let mut previous = line;
        for node in nodes {
            tx.insert_after(previous, node, false)?;
            previous = node;
        }
    }
    tx.set_text_node_range(
        a,
        Utf16Offset(range.anchor.offset()),
        f,
        Utf16Offset(range.focus.offset()),
    )?;
    Ok(true)
}
/// Home/End movement within a code line, including RTL and Shift extension.
pub fn handle_move_to(
    tx: &mut Transaction<'_>,
    to_start: bool,
    shift: bool,
) -> Result<bool, Error> {
    if !is_selection_in_code(tx, tx.selection()) {
        return Ok(false);
    }
    let range = tx.range_selection()?.clone();
    if !is_code_line_node(tx, range.anchor.key()) || !is_code_line_node(tx, range.focus.key()) {
        return Ok(false);
    }
    let key = range.focus.key();
    let to_start = if code_line_direction(tx, key) == Some(TextDirection::Rtl) {
        !to_start
    } else {
        to_start
    };
    if to_start {
        if let Some((node, offset)) =
            start_of_code_in_line(tx, key, Utf16Offset(range.focus.offset()))?
        {
            if tx.is_line_break(node) {
                tx.select_next(node, Some(Utf16Offset::ZERO), Some(Utf16Offset::ZERO))?;
            } else {
                tx.set_text_node_range(node, offset, node, offset)?;
            }
        } else {
            let parent = tx.parent_or_err(key)?;
            tx.select_start(parent)?;
        }
    } else {
        let last = end_of_code_in_line(tx, key)?;
        tx.select_end(last)?;
    }
    if shift {
        tx.set_point(PointRole::Anchor, range.anchor)?;
    }
    Ok(true)
}
#[cfg(test)]
mod test;
