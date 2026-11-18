//! Structural half of Source's code transform; syntax tokens come from the host tokenizer
//! (tokens.rs) on view-attached surfaces.
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
    let mut needs_flattening = false;
    let mut child = tx.first_child(code);
    while let Some(key) = child {
        child = tx.next_sibling(key);
        // Prism replaces ordinary imported text with fresh unformatted tokens,
        // but retains matching CodeHighlight nodes. Keep the native text key and
        // selection format: token painting remains a view concern.
        if tx
            .view()
            .node(key)
            .is_some_and(|node| node.data_any().is::<Text>())
            && tx
                .view()
                .text(key)
                .is_some_and(|text| !text.format.is_empty())
        {
            tx.text(key)?.set_format(TextFormat::empty())?;
        }
        if !tx.is_line_break(key) && !tx.is::<Tab>(key) {
            needs_flattening |= !tx.is_text(key) || tx.text_content(key).contains(['\n', '\t']);
        }
    }
    if !needs_flattening {
        return Ok(());
    }

    let caret = capture_caret(tx, code);

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

    restore_caret(tx, code, caret)
}

fn same_run(tx: &Transaction<'_>, left: NodeKey, right: NodeKey) -> bool {
    tx.type_name(left).ok() == tx.type_name(right).ok()
        && tx.text_content(left) == tx.text_content(right)
}

/// The selection facts Source `$updateAndRetainSelection` captures before a code splice.
pub(super) struct Caret {
    caret: Option<Point>,
    line_boundary: Option<(NodeKey, ChildIndex)>,
    text_offset: i64,
}

pub(super) fn capture_caret(tx: &Transaction<'_>, code: NodeKey) -> Caret {
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

    Caret {
        caret,
        line_boundary,
        text_offset,
    }
}

/// Restore the captured caret after a splice, as Source `$updateAndRetainSelection`.
pub(super) fn restore_caret(
    tx: &mut Transaction<'_>,
    code: NodeKey,
    caret: Caret,
) -> Result<(), Error> {
    let Caret {
        caret,
        line_boundary,
        mut text_offset,
    } = caret;
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
