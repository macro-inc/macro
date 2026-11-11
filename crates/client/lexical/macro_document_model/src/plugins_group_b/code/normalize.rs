//! Structural half of Source's code transform; syntax tokens belong to the view.
use super::*;
use lexical_rich_nodes::code::plainify_code_content;

/// Normalize a changed direct text run through the same code-node transform.
pub(super) fn text(tx: &mut Transaction<'_>, node: NodeKey) -> Result<(), Error> {
    let Some(parent) = tx.parent(node) else {
        return Ok(());
    };
    let Some(code) = tx.view().cast::<CodeNode>(parent) else {
        return Ok(());
    };
    normalize(tx, code)
}

pub(super) fn normalize(tx: &mut Transaction<'_>, code: Id<CodeNode>) -> Result<(), Error> {
    let code = code.key();
    if !tx.is_attached(code) {
        return Ok(());
    }
    if !tx.children(code).any(|child| {
        if tx.is_line_break(child) || tx.is::<Tab>(child) {
            return false;
        }
        !tx.is_text(child) || tx.text_content(child).contains(['\n', '\t'])
    }) {
        return Ok(());
    }

    // Source retains the anchor's sibling-relative text offset even when an
    // inserted rich child currently owns the caret. Capture before splicing.
    let caret = tx
        .selection()
        .and_then(Selection::as_range)
        .map(|range| range.anchor);
    let line_boundary = caret.and_then(|point| match point {
        Point::Element { offset, .. } if offset.0 > 0 => tx
            .child_at_index(code, ChildIndex(offset.0 - 1))
            .filter(|child| tx.is_line_break(*child))
            .map(|_| (point.key(), offset)),
        _ => None,
    });
    let mut text_offset = caret.map(|point| i64::from(point.offset())).unwrap_or(0);
    if line_boundary.is_none()
        && let Some(point) = caret
    {
        let mut previous = tx.prev_sibling(point.key());
        while let Some(key) = previous {
            text_offset += i64::from(tx.text_content_size(key).0);
            previous = tx.prev_sibling(key);
        }
    }

    let content = tx.text_content(code).into_owned();
    let previous = tx.children_keys(code)?;
    let next = plainify_code_content(tx, &content)?;
    let mut leading = 0;
    while leading < previous.len().min(next.len()) && same_run(tx, previous[leading], next[leading])
    {
        leading += 1;
    }
    let mut trailing = 0;
    while trailing < previous.len().min(next.len()) - leading
        && same_run(
            tx,
            previous[previous.len() - trailing - 1],
            next[next.len() - trailing - 1],
        )
    {
        trailing += 1;
    }
    tx.splice(
        code,
        ChildIndex(leading as u32),
        (previous.len() - leading - trailing) as u32,
        &next[leading..next.len() - trailing],
    )?;

    if let Some((original, offset)) = line_boundary {
        tx.element(original)?.select(Some(offset), Some(offset))?;
    } else if caret.is_some() {
        for child in tx.children_keys(code)? {
            if !tx.is_text(child) && !tx.is_line_break(child) {
                continue;
            }
            let size = i64::from(tx.text_content_size(child).0);
            if tx.is_text(child) && size >= text_offset {
                // Source can compute -1 after a leading line break. Keep the
                // current valid native caret rather than creating an invalid point.
                if text_offset < 0 {
                    break;
                }
                let offset = Utf16Offset(
                    u32::try_from(text_offset)
                        .map_err(|_| Error::Invariant("code caret exceeds UTF-16 range"))?,
                );
                tx.text(child)?.select(Some(offset), Some(offset))?;
                break;
            }
            text_offset -= size;
        }
    }
    Ok(())
}

fn same_run(tx: &Transaction<'_>, left: NodeKey, right: NodeKey) -> bool {
    tx.type_name(left).ok() == tx.type_name(right).ok()
        && tx.text_content(left) == tx.text_content(right)
}
