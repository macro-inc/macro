//! Shared list import/export with configurable indentation.
use crate::util::js_trim;
use crate::{matcher::*, patterns, state::*, util::*, *};
use lexical_model::*;
use lexical_rich_nodes::list::{item::*, node::*};
/// Spaces and tabs across the complete matched whitespace prefix.
pub fn get_indent(ws: &str, list_indent: u8) -> Result<u32> {
    if list_indent == 0 {
        return Err(crate::Error::InvalidArgument(
            "list_indent must be positive",
        ));
    }
    Ok((ws.bytes().filter(|b| *b == 9).count()
        + ws.bytes().filter(|b| *b == 32).count() / usize::from(list_indent)) as u32)
}
fn replace_list(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    parent: NodeKey,
    children: &[NodeKey],
    m: &Match,
    is_import: bool,
    kind: ListType,
) -> Result<ReplaceResult> {
    opts.validate()?;
    let previous = tx.prev_sibling(parent);
    let next = tx.next_sibling(parent);
    let item = create_list_item_node(
        tx,
        if kind == ListType::Check {
            Some(m.get(3) == Some("x"))
        } else {
            None
        },
    )?;
    let marker = if kind != ListType::Number {
        js_trim(m.full())
            .chars()
            .next()
            .filter(|c| matches!(c, '-' | '*' | '+'))
            .map(|c| c.to_string())
    } else {
        None
    };
    if let Some(next) = next.filter(|k| {
        tx.get::<ListNode>(*k)
            .is_some_and(|l| l.list_type() == kind)
    }) {
        if let Some(marker) = marker {
            tx.set_state(next, &LIST_MARKER_STATE, marker)?;
        }
        if let Some(first) = tx.first_child(next) {
            tx.insert_before(first, item, true)?;
        } else {
            tx.append(next, &[item.key()])?;
        }
        tx.remove(parent, false)?;
    } else if let Some(previous) = previous.filter(|k| {
        tx.get::<ListNode>(*k)
            .is_some_and(|l| l.list_type() == kind)
    }) {
        if let Some(marker) = marker {
            tx.set_state(previous, &LIST_MARKER_STATE, marker)?;
        }
        tx.append(previous, &[item.key()])?;
        tx.remove(parent, false)?;
    } else {
        let start = if kind == ListType::Number {
            m.get(2).unwrap_or("1").parse::<i32>().map_err(|_| {
                crate::Error::InvalidArgument("ordered list start exceeds the model i32 range")
            })?
        } else {
            1
        };
        let list = create_list_node(tx, kind, start)?;
        if let Some(marker) = marker {
            tx.set_state(list, &LIST_MARKER_STATE, marker)?;
        }
        tx.append(list, &[item.key()])?;
        tx.replace(parent, list, false)?;
    }
    tx.append(item, children)?;
    if !is_import {
        tx.element(item)?
            .select(Some(ChildIndex(0)), Some(ChildIndex(0)))?;
    }
    let indent = get_indent(m.get(1).unwrap_or(""), opts.list_indent)?;
    if indent > 0 {
        set_indent(tx, item, indent)?;
    }
    Ok(ReplaceResult::Handled)
}
fn list_export(cx: &mut ExportCx<'_>, node: NodeKey, depth: usize) -> Result<String> {
    let list = cx
        .state()
        .get::<ListNode>(node)
        .ok_or(lexical_model::Error::NodeTypeMismatch(node))?
        .clone();
    let marker = cx.state().get_state(node, &LIST_MARKER_STATE)?;
    let mut out = Vec::new();
    let mut index = 0;
    for item in cx.state().children_keys(node)? {
        if !cx.state().is::<ListItemNode>(item) {
            continue;
        }
        let children = cx.state().children_keys(item)?;
        if children.len() == 1 && cx.state().is::<ListNode>(children[0]) {
            let text = list_export(cx, children[0], depth + 1)?;
            if !text.is_empty() {
                out.push(text);
            }
            continue;
        }
        if let Some(selection) = cx.selection()
            && !children
                .iter()
                .any(|k| cx.state().is_selected(*k, Some(selection)))
        {
            continue;
        }
        let prefix = match list.list_type() {
            ListType::Number => format!("{}. ", i64::from(list.start()) + index),
            ListType::Bullet => format!("{marker} "),
            ListType::Check => format!(
                "{marker} [{}] ",
                if cx
                    .state()
                    .get::<ListItemNode>(item)
                    .is_some_and(|i| i.checked == Some(true))
                {
                    "x"
                } else {
                    " "
                }
            ),
        };
        let mut text = cx.export_children(item)?;
        if list.list_type() != ListType::Number
            && let Some(m) = patterns::LIST_ESCAPE.exec(&text)
        {
            let at = len(m.get(1).unwrap_or(""));
            text = slice(&text, 0, at) + "\\" + &slice(&text, at, len(&text));
        }
        out.push(format!(
            "{}{prefix}{text}",
            " ".repeat(depth * usize::from(cx.options().list_indent))
        ));
        index += 1;
    }
    Ok(out.join("\n"))
}

/// Standard bullet list transformer.
#[derive(Debug)]
pub struct UnorderedList;
/// Shared bullet transformer instance.
pub static UNORDERED_LIST: UnorderedList = UnorderedList;
impl ElementTransformer for UnorderedList {
    fn dependencies(&self) -> &[&'static str] {
        &["list", "listitem"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::UNORDERED_LIST
    }
    fn trigger_on_enter(&self) -> bool {
        true
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        if cx.state().is::<ListNode>(node) {
            Ok(Some(list_export(cx, node, 0)?))
        } else {
            Ok(None)
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        replace_list(tx, opts, parent, children, m, is_import, ListType::Bullet)
    }
}

/// Standard number list transformer.
#[derive(Debug)]
pub struct OrderedList;
/// Shared number transformer instance.
pub static ORDERED_LIST: OrderedList = OrderedList;
impl ElementTransformer for OrderedList {
    fn dependencies(&self) -> &[&'static str] {
        &["list", "listitem"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::ORDERED_LIST
    }
    fn trigger_on_enter(&self) -> bool {
        true
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        if cx.state().is::<ListNode>(node) {
            Ok(Some(list_export(cx, node, 0)?))
        } else {
            Ok(None)
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        replace_list(tx, opts, parent, children, m, is_import, ListType::Number)
    }
}

/// Standard check list transformer.
#[derive(Debug)]
pub struct CheckList;
/// Shared check transformer instance.
pub static CHECK_LIST: CheckList = CheckList;
impl ElementTransformer for CheckList {
    fn dependencies(&self) -> &[&'static str] {
        &["list", "listitem"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::CHECK_LIST
    }
    fn trigger_on_enter(&self) -> bool {
        true
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        if cx.state().is::<ListNode>(node) {
            Ok(Some(list_export(cx, node, 0)?))
        } else {
            Ok(None)
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        opts: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        replace_list(tx, opts, parent, children, m, is_import, ListType::Check)
    }
}
#[cfg(test)]
mod test;
