//! Source edge-arrow movement for code/highlight selection points.
use super::*;
use lexical_rich_nodes::code::CodeHighlightNode;

pub(super) fn arrow(tx: &mut Transaction<'_>, down: bool) -> Result<Handled, Error> {
    let Some(range) = tx
        .selection()
        .and_then(Selection::as_range)
        .filter(|range| range.is_collapsed())
        .cloned()
    else {
        return Ok(Handled::No);
    };
    let focus = range.focus;
    let target = if tx.is::<CodeNode>(focus.key()) {
        Some(focus.key())
    } else if tx.is::<CodeHighlightNode>(focus.key()) {
        tx.parent(focus.key()).filter(|key| tx.is::<CodeNode>(*key))
    } else {
        None
    };
    let Some(code) = target else {
        return Ok(Handled::No);
    };
    let children = tx.children_keys(code)?;
    let mut lines: Vec<Vec<NodeKey>> = vec![Vec::new()];
    for key in &children {
        if tx.is::<LineBreak>(*key) {
            lines.push(Vec::new());
        } else if let Some(line) = lines.last_mut() {
            line.push(*key);
        }
    }
    let line = lines.iter().position(|line| line.contains(&focus.key()));
    let (edge_line, edge_position) = if let Some(line) = line {
        let keys = lines.get(line).ok_or(Error::Invariant("code line"))?;
        let size = tx.text_content_size(focus.key()).0;
        let collapsed = keys.len() == 1 && size <= 1;
        let at_start = keys.first() == Some(&focus.key()) && focus.offset() == 0;
        let at_end = keys.last() == Some(&focus.key()) && focus.offset() == size;
        (
            if down {
                line + 1 == lines.len()
            } else {
                line == 0
            },
            collapsed || if down { at_end } else { at_start },
        )
    } else if focus.key() == code {
        let collapsed = children.len() <= 1;
        (
            collapsed
                || if down {
                    focus.offset() == tx.children_size(code)
                } else {
                    focus.offset() == 0
                },
            true,
        )
    } else {
        return Ok(Handled::No);
    };
    if !edge_line {
        return Ok(Handled::No);
    }
    if down {
        if tx.next_sibling(code).is_none() {
            let p = tx.create(Paragraph::default())?;
            tx.insert_after(code, p, true)?;
            tx.select_start(p)?;
        }
        if edge_position {
            tx.select_next(focus.key(), None, None)?;
        }
    } else {
        if tx.prev_sibling(code).is_none() {
            let p = tx.create(Paragraph::default())?;
            tx.insert_before(code, p, true)?;
            tx.select_start(p)?;
        }
        if edge_position {
            tx.select_previous(focus.key(), None, None)?;
        }
    }
    tx.prevent_default();
    Ok(Handled::Yes)
}
