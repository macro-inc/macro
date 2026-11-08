//! Markdown block import and recursive inline transformation.
pub mod text;
pub mod text_format;
pub mod text_match;
use crate::{state::*, util::*, *};
use lexical_model::*;
use lexical_rich_nodes::{
    list::{item::ListItemNode, node::ListNode},
    quote::QuoteNode,
};
/// Convert markdown into a root or element inside the caller's transaction.
pub fn convert_from_markdown_string(
    tx: &mut Transaction<'_>,
    markdown: &str,
    transformers: &Transformers,
    node: Option<NodeKey>,
    opts: &MarkdownOptions,
) -> Result<()> {
    opts.validate()?;
    let markdown = if opts.should_preserve_new_lines {
        markdown.into()
    } else {
        normalize_markdown(markdown, opts.should_merge_adjacent_lines)
    };
    let lines: Vec<String> = markdown.split('\n').map(str::to_owned).collect();
    let root = node.unwrap_or(NodeKey::ROOT);
    for child in tx.children_keys(root)? {
        tx.remove(child, false)?;
    }
    let mut i = 0;
    while i < lines.len() {
        let (imported, last) = import_multiline(tx, &lines, i, root, transformers, opts)?;
        if imported {
            i = last;
        } else {
            import_blocks(tx, &lines[i], root, transformers, opts)?;
        }
        i += 1;
    }
    for child in tx.children_keys(root)? {
        if !opts.should_preserve_new_lines
            && is_empty_paragraph(tx.view(), child)
            && tx.children_size(root) > 1
        {
            tx.remove(child, false)?;
            continue;
        }
        if tx.is_element(child) {
            let texts: Vec<_> = tx
                .descendants(child)
                .map(|(key, _)| key)
                .filter(|k| tx.is_text(*k))
                .collect();
            for text in texts {
                normalize_tabs(tx, text)?;
            }
        }
    }
    if tx.selection().is_some() {
        tx.select_start(root)?;
    }
    Ok(())
}
fn import_multiline(
    tx: &mut Transaction<'_>,
    lines: &[String],
    start: usize,
    root: NodeKey,
    t: &Transformers,
    opts: &MarkdownOptions,
) -> Result<(bool, usize)> {
    for transformer in &t.multiline_element {
        let Some(m) = transformer.reg_exp_start().exec(&lines[start]) else {
            continue;
        };
        match transformer.handle_import_after_start_match(tx, opts, lines, root, start, &m)? {
            AfterStartMatch::Skip => continue,
            AfterStartMatch::Done {
                imported,
                last_line,
            } => {
                if imported && (last_line >= lines.len() || last_line < start) {
                    return Err(crate::Error::InvalidArgument(
                        "multiline hook returned an invalid line index",
                    ));
                }
                return Ok((imported, last_line));
            }
            AfterStartMatch::Default => {}
        }
        let (regex, optional) = match transformer.reg_exp_end() {
            RegExpEnd::None => (None, true),
            RegExpEnd::Optional(r) => (Some(r), true),
            RegExpEnd::Required(r) => (Some(r), false),
        };
        for end in start..lines.len() {
            let end_match = regex.and_then(|r| r.exec(&lines[end]));
            if end_match.is_none() && (!optional || end + 1 < lines.len()) {
                continue;
            }
            if end == start && end_match.as_ref().is_some_and(|e| e.index == m.index) {
                continue;
            }
            let first = m.full_len16() as usize;
            let cut = end_match.as_ref().map(|e| e.full_len16() as usize);
            let between = (start..=end)
                .map(|j| {
                    let n = len(&lines[j]);
                    let e = if j == end {
                        cut.map_or(n, |c| if c == 0 { 0 } else { n.saturating_sub(c) })
                    } else {
                        n
                    };
                    slice(&lines[j], if j == start { first } else { 0 }, e)
                })
                .collect();
            if transformer.replace(
                tx,
                opts,
                root,
                None,
                &m,
                end_match.as_ref(),
                Some(between),
                true,
            )? == ReplaceResult::Handled
            {
                return Ok((true, end));
            }
            break;
        }
    }
    Ok((false, start))
}
fn import_blocks(
    tx: &mut Transaction<'_>,
    line: &str,
    root: NodeKey,
    t: &Transformers,
    opts: &MarkdownOptions,
) -> Result<()> {
    let text = tx.create_text(line)?;
    let paragraph = tx.create(Paragraph {})?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(root, &[paragraph.key()])?;
    for transformer in &t.element {
        if let Some(m) = transformer.reg_exp().exec(line) {
            tx.text(text)?
                .set_text_content(&slice(line, m.full_len16() as usize, len(line)))?;
            if transformer.replace(tx, opts, paragraph.key(), &[text.key()], &m, true)?
                == ReplaceResult::Handled
            {
                break;
            }
        }
    }
    text::import_text_transformers(tx, text.key(), t)?;
    if tx.is_attached(paragraph)
        && !line.is_empty()
        && !opts.should_preserve_new_lines
        && let Some(previous) = tx.prev_sibling(paragraph)
    {
        let target = if tx.is::<ListNode>(previous) {
            tx.last_descendant(previous)
                .and_then(|k| tx.find_matching_parent(k, |v, k| v.is::<ListItemNode>(k)))
        } else if tx.is::<Paragraph>(previous) || tx.is::<QuoteNode>(previous) {
            Some(previous)
        } else {
            None
        };
        if let Some(target) = target.filter(|k| tx.text_content_size(*k).get() > 0) {
            let br = create_markdown_line_break_node(tx, target)?;
            let mut nodes = vec![br];
            nodes.extend(tx.children_keys(paragraph)?);
            tx.append(target, &nodes)?;
            tx.remove(paragraph, false)?;
        }
    }
    Ok(())
}
fn normalize_tabs(tx: &mut Transaction<'_>, text: NodeKey) -> Result<()> {
    let offsets: Vec<_> = tx
        .text_content(text)
        .encode_utf16()
        .enumerate()
        .filter(|(_, c)| *c == 9)
        .flat_map(|(i, _)| [Utf16Offset(i as u32), Utf16Offset(i as u32 + 1)])
        .collect();
    if offsets.is_empty() {
        return Ok(());
    }
    for part in tx.text(text)?.split_text(&offsets)? {
        if tx.text_content(part) == "\t" {
            let tab = tx.create(Tab {})?;
            tx.replace(part, tab, false)?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod test;
