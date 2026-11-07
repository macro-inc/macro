use super::*;
use lexical_model::*;
/// Click clears a node selection; a range only processes format escaping.
pub fn click(tx: &mut Transaction<'_>, cfg: &EscapeFormatTriggerConfig) -> crate::Result<bool> {
    match tx.selection() {
        Some(Selection::Node(_)) => {
            tx.set_selection(Some(Selection::Node(NodeSelection::new())))?;
            Ok(true)
        }
        Some(Selection::Range(_)) => {
            escape_formats_for_trigger(
                tx,
                SelectionSlot::Active,
                EscapeFormatTrigger::Click,
                EscapeDirection::Both,
                cfg,
            )?;
            Ok(false)
        }
        _ => Ok(false),
    }
}
/// Delete a character with an explicit host layout result, or delete a node selection.
pub fn delete_character(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
) -> crate::Result<bool> {
    match tx.selection() {
        Some(Selection::Range(_)) => tx.delete_character(direction, target)?,
        Some(Selection::Node(_)) => tx.delete_nodes()?,
        _ => return Ok(false),
    }
    Ok(true)
}
/// Delete a word from a range using host targets.
pub fn delete_word(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
    character_target: ModifyTarget,
) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.delete_word(direction, target, character_target)?;
    Ok(true)
}
/// Delete to a visual line boundary from a range using host targets.
pub fn delete_line(
    tx: &mut Transaction<'_>,
    direction: EditDirection,
    target: ModifyTarget,
    character_target: ModifyTarget,
) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.delete_line(direction, target, character_target)?;
    Ok(true)
}
/// Insert string payloads; null selection still reports handled, as upstream.
pub fn controlled_text_insertion(tx: &mut Transaction<'_>, text: &str) -> crate::Result<bool> {
    if matches!(tx.selection(), Some(Selection::Range(_))) {
        tx.insert_text(text)?;
    }
    Ok(true)
}
/// Remove range contents, returning false for other selection kinds.
pub fn remove_text(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.remove_text()?;
    Ok(true)
}
/// Apply a text format to a range.
pub fn format_text(tx: &mut Transaction<'_>, format: TextFormatType) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.format_text(format, None)?;
    Ok(true)
}
/// Format the nearest non-inline element of each selected node.
pub fn format_element(tx: &mut Transaction<'_>, format: ElementFormat) -> crate::Result<bool> {
    let Some(selection @ (Selection::Range(_) | Selection::Node(_))) = tx.selection() else {
        return Ok(false);
    };
    let nodes = selection.nodes(tx.view())?;
    for node in nodes {
        if let Some(block) =
            tx.find_matching_parent(node, |v, k| v.is_element(k) && !v.is_inline(k))
        {
            tx.element(block)?.set_format(format)?;
        }
    }
    Ok(true)
}
/// Insert a line break in a range.
pub fn insert_line_break(tx: &mut Transaction<'_>, select_start: bool) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.insert_line_break(select_start)?;
    Ok(true)
}
/// Split the selected block with its virtual `insert_new_after` hook.
pub fn insert_paragraph(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    if !matches!(tx.selection(), Some(Selection::Range(_))) {
        return Ok(false);
    }
    tx.insert_paragraph()?;
    Ok(true)
}
/// Insert a tab, copying range typing format and style when present.
pub fn insert_tab(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    let range = tx.selection().and_then(Selection::as_range).cloned();
    let tab = tx.create(Tab {})?;
    if let Some(range) = range {
        tx.text(tab)?
            .set_format(range.format)?
            .set_style(&range.style)?;
    }
    tx.insert_nodes_at_selection(&[tab.key()])?;
    Ok(true)
}
/// Indent each selected block once.
pub fn indent_content(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    crate::utils::handle_indent_and_outdent(tx, |tx, key| {
        let indent = tx.indent(key).saturating_add(1);
        tx.set_indent(key, indent)?;
        Ok(())
    })
}
/// Outdent each selected block once, clamping at zero.
pub fn outdent_content(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    crate::utils::handle_indent_and_outdent(tx, |tx, key| {
        let indent = tx.indent(key).saturating_sub(1);
        tx.set_indent(key, indent)?;
        Ok(())
    })
}
/// Select the complete document, even when selection is null.
pub fn select_all(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    tx.select_all(None)?;
    Ok(true)
}
/// Model half of cut, after the view has written the clipboard.
pub fn cut_selection(tx: &mut Transaction<'_>) -> crate::Result<()> {
    match tx.selection() {
        Some(Selection::Range(_)) => tx.remove_text()?,
        Some(Selection::Node(_)) => {
            let nodes = tx
                .selection()
                .ok_or(lexical_model::Error::NoSelection)?
                .nodes(tx.view())?;
            for key in nodes {
                tx.remove(key, false)?;
            }
        }
        _ => {}
    }
    Ok(())
}
/// Clear the root, append a paragraph and reset range typing format.
pub fn clear_editor(tx: &mut Transaction<'_>) -> crate::Result<bool> {
    let had_selection = tx.selection().is_some();
    let count = tx.children_size(NodeKey::ROOT);
    tx.splice(NodeKey::ROOT, ChildIndex(0), count, &[])?;
    let paragraph = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    if had_selection {
        tx.select_start(paragraph)?;
    }
    if matches!(tx.selection(), Some(Selection::Range(_))) {
        tx.set_selection_format(TextFormat::empty())?;
    }
    Ok(true)
}
/// Convert the view-resolved drop point into a normalized model range.
pub fn set_drop_selection(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    offset: Utf16Offset,
) -> crate::Result<()> {
    let point = if tx.is_text(node) {
        Point::text(node, offset)
    } else {
        Point::element(
            tx.parent_or_err(node)?,
            ChildIndex(
                tx.index_within_parent(node)
                    .ok_or(lexical_model::Error::NoParent(node))?
                    .0
                    + 1,
            ),
        )
    };
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))?;
    tx.normalize_selection()?;
    Ok(())
}
#[cfg(test)]
mod test;
