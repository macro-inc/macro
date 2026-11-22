//! List registration and style/strict-indent transforms.
use super::*;
use super::{format::*, item::*, utils::*};
use std::collections::VecDeque;
/// Upstream registerList options.
#[derive(Clone, Copy, Debug, Default)]
pub struct RegisterListOptions {
    /// Retain ordered numbering after Enter splits a list.
    pub restore_numbering: bool,
}
/// ListExtension configuration.
#[derive(Clone, Copy, Debug, Default)]
pub struct ListConfig {
    /// Prevent indentation jumps deeper than the preceding leaf.
    pub has_strict_indent: bool,
    /// Preserve ordered numbering after an empty item.
    pub should_preserve_numbering: bool,
}
/// Register both nodes and their intrinsic transforms.
pub fn register_list_nodes(b: EditorBuilder) -> EditorBuilder {
    b.node::<ListNode>().node::<ListItemNode>()
}
/// Register the model style-sync transforms and retain command options per editor.
pub fn register_list(b: EditorBuilder, options: RegisterListOptions) -> EditorBuilder {
    b.extension_state(options)
        .plugin(super::commands::ListCommands)
        .transform::<ListItemNode>(list_item_text_style_transform)
        .transform::<Text>(list_text_node_transform)
}
/// Register the optional strict-indent transform.
pub fn register_list_strict_indent_transform(b: EditorBuilder) -> EditorBuilder {
    b.transform::<ListNode>(process_list_with_strict_indent)
}
/// Compose node and transform registration from extension configuration.
pub fn list_extension(b: EditorBuilder, config: ListConfig) -> EditorBuilder {
    let b = register_list(
        register_list_nodes(b),
        RegisterListOptions {
            restore_numbering: config.should_preserve_numbering,
        },
    );
    if config.has_strict_indent {
        register_list_strict_indent_transform(b)
    } else {
        b
    }
}
/// Update number-list start; all list types claim the command.
pub fn update_list_start(tx: &mut Transaction<'_>, list: NodeKey, new_start: i32) -> Result<bool> {
    let Some(id) = tx.view().cast::<ListNode>(list) else {
        return Ok(false);
    };
    if tx
        .get::<ListNode>(id)
        .is_some_and(|n| n.list_type() == ListType::Number)
    {
        tx.get_mut::<ListNode>(id)?.set_start(new_start);
        update_children_list_item_value(tx, id)?;
    }
    Ok(true)
}
/// Sync an item's text style and format from its first text child or empty selection.
pub fn list_item_text_style_transform(
    tx: &mut Transaction<'_>,
    item: Id<ListItemNode>,
) -> Result<()> {
    let attributes = if let Some(first) = tx.first_child(item) {
        tx.view().text(first).map(|t| (t.format, t.style.clone()))
    } else {
        tx.selection()
            .and_then(Selection::as_range)
            .filter(|r| r.is_collapsed() && r.anchor.key() == item.key())
            .map(|r| (r.format, r.style.clone()))
    };
    if let Some((format, style)) = attributes {
        let data = tx.element_data(item)?;
        if data.text_format != format || data.text_style != style {
            tx.element(item)?
                .set_text_format(format)?
                .set_text_style(&style)?;
        }
    }
    Ok(())
}
/// Sync the parent item when its first text child changes.
pub fn list_text_node_transform(tx: &mut Transaction<'_>, text: Id<Text>) -> Result<()> {
    if let Some(item) = tx
        .parent(text)
        .and_then(|k| tx.view().cast::<ListItemNode>(k))
        && tx.first_child(item) == Some(text.key())
    {
        list_item_text_style_transform(tx, item)?;
    }
    Ok(())
}
/// Breadth-first normalization of indentation jumps.
pub fn process_list_with_strict_indent(tx: &mut Transaction<'_>, list: Id<ListNode>) -> Result<()> {
    let mut queue = VecDeque::from([list]);
    while let Some(list) = queue.pop_front() {
        for key in tx.children_keys(list)? {
            let Some(item) = tx.view().cast::<ListItemNode>(key) else {
                continue;
            };
            format_list_indent_strict(tx, item)?;
            if let Some(inner) = tx
                .first_child(item)
                .and_then(|k| tx.view().cast::<ListNode>(k))
            {
                queue.push_back(inner);
            }
        }
    }
    Ok(())
}
fn format_list_indent_strict(tx: &mut Transaction<'_>, item: Id<ListItemNode>) -> Result<()> {
    if is_nested_list_node(tx, item.key()) {
        return Ok(());
    }
    let Some(list) = tx.parent(item).and_then(|k| tx.view().cast::<ListNode>(k)) else {
        return Ok(());
    };
    let start = std::iter::once(item.key())
        .chain(tx.ancestors(item))
        .find(|k| {
            tx.is::<ListItemNode>(*k)
                && tx.parent(*k).is_some_and(|p| tx.is::<ListNode>(p))
                && tx
                    .prev_sibling(*k)
                    .is_some_and(|p| tx.is::<ListItemNode>(p))
        });
    if let Some(start) = start {
        let mut previous = tx.prev_sibling(start).ok_or(Error::NoParent(start))?;
        while let Some(inner) = tx.first_child(previous).filter(|k| tx.is::<ListNode>(*k)) {
            let Some(last) = tx.last_child(inner).filter(|k| tx.is::<ListItemNode>(*k)) else {
                break;
            };
            previous = last;
        }
        if let Some(previous_list) = tx
            .parent(previous)
            .and_then(|k| tx.view().cast::<ListNode>(k))
        {
            let depth = get_list_depth(tx, previous_list)?;
            if depth + 1 < get_list_depth(tx, list)? {
                set_indent(tx, item, depth)?;
            }
        }
    } else if get_indent(tx, item) > 0 {
        set_indent(tx, item, 0)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;

/// Model Enter routing with the registered options. Call before rich_text::insert_paragraph
/// when routing a host INSERT_PARAGRAPH command; stock editing-command keys belong to core.
pub fn handle_registered_insert_paragraph(tx: &mut Transaction<'_>) -> Result<bool> {
    let restore = tx.extension::<RegisterListOptions>()?.restore_numbering;
    handle_list_insert_paragraph(tx, restore)
}
