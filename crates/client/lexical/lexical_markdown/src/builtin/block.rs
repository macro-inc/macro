//! Heading and quote block transformers.
use crate::{matcher::*, patterns, state::*, *};
use lexical_model::*;
use lexical_rich_nodes::{heading::*, quote::*};
/// Heading transformer.
#[derive(Debug)]
pub struct Heading;
/// Standard heading transformer.
pub static HEADING: Heading = Heading;
/// Quote transformer.
#[derive(Debug)]
pub struct Quote;
/// Standard quote transformer.
pub static QUOTE: Quote = Quote;
pub(super) fn create_block(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    parent: NodeKey,
    children: &[NodeKey],
    is_import: bool,
) -> Result<ReplaceResult> {
    tx.append(node, children)?;
    tx.replace(parent, node, false)?;
    if !is_import {
        tx.element(node)?
            .select(Some(ChildIndex(0)), Some(ChildIndex(0)))?;
    }
    Ok(ReplaceResult::Handled)
}
impl ElementTransformer for Heading {
    fn dependencies(&self) -> &[&'static str] {
        &["heading"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::HEADING
    }
    fn trigger_on_enter(&self) -> bool {
        true
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        let Some(h) = cx.state().get::<HeadingNode>(node) else {
            return Ok(None);
        };
        let n = match h.tag {
            HeadingTagType::H1 => 1,
            HeadingTagType::H2 => 2,
            HeadingTagType::H3 => 3,
            HeadingTagType::H4 => 4,
            HeadingTagType::H5 => 5,
            HeadingTagType::H6 => 6,
        };
        Ok(Some(format!(
            "{} {}",
            "#".repeat(n),
            cx.export_children(node)?
        )))
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        m: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        let tag = match m.get(1).map(str::len) {
            Some(1) => HeadingTagType::H1,
            Some(2) => HeadingTagType::H2,
            Some(3) => HeadingTagType::H3,
            Some(4) => HeadingTagType::H4,
            Some(5) => HeadingTagType::H5,
            Some(6) => HeadingTagType::H6,
            _ => return Err(crate::Error::InvalidArgument("invalid heading match")),
        };
        let node = create_heading_node(tx, tag)?;
        create_block(tx, node.key(), parent, children, is_import)
    }
}
impl ElementTransformer for Quote {
    fn dependencies(&self) -> &[&'static str] {
        &["quote"]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*patterns::QUOTE
    }
    fn trigger_on_enter(&self) -> bool {
        true
    }
    fn export(&self, cx: &mut ExportCx<'_>, node: NodeKey) -> Result<Option<String>> {
        if !cx.state().is::<QuoteNode>(node) {
            return Ok(None);
        }
        Ok(Some(
            cx.export_children(node)?
                .split('\n')
                .map(|s| format!("> {s}"))
                .collect::<Vec<_>>()
                .join("\n"),
        ))
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        parent: NodeKey,
        children: &[NodeKey],
        _: &Match,
        is_import: bool,
    ) -> Result<ReplaceResult> {
        if is_import && let Some(prev) = tx.prev_sibling(parent).filter(|k| tx.is::<QuoteNode>(*k))
        {
            let br = create_markdown_line_break_node(tx, prev)?;
            let mut nodes = vec![br];
            nodes.extend_from_slice(children);
            tx.append(prev, &nodes)?;
            tx.remove(parent, false)?;
            return Ok(ReplaceResult::Handled);
        }
        let quote = create_quote_node(tx)?;
        create_block(tx, quote.key(), parent, children, is_import)
    }
}
#[cfg(test)]
mod test;
