//! Recursive quote import retains nested HTML blockquote depth.
use super::*;
use crate::nodes::*;
use lexical_markdown::{Error, Result};
use lexical_model::*;
use lexical_rich_nodes::quote::QuoteNode;
use serde_json::json;
fn registry(html: bool, options: &MacroMarkdownOptions) -> Result<Transformers> {
    let mut out = Vec::new();
    if html {
        out.push(transformer("HTML_BLOCKQUOTE", options)?);
    }
    out.push(transformer("I_HTML_RENDER", options)?);
    for name in list_names("custom").ok_or(Error::InvalidArgument("custom list"))? {
        out.push(transformer(name, options)?);
    }
    for name in [
        "I_EQUATION_NODE",
        "I_USER_MENTION",
        "I_DOCUMENT_MENTION",
        "I_CONTACT_MENTION",
    ] {
        out.push(transformer(name, options)?);
    }
    out.extend(lexical_markdown::builtin::transformers());
    Ok(Transformers::new(out))
}
fn normalized(content: &str) -> Result<String> {
    let regex = RegexMatcher::new("<br\\s*/?>", "i")?;
    let mut output = String::new();
    let mut cursor = 0;
    let units: Vec<_> = content.encode_utf16().collect();
    for m in regex.find_all(content) {
        output.push_str(&String::from_utf16_lossy(
            units
                .get(cursor..m.index.get() as usize)
                .ok_or(Error::InvalidArgument("invalid quote match offset"))?,
        ));
        output.push('\n');
        cursor = m.end().get() as usize;
    }
    output.push_str(&String::from_utf16_lossy(
        units
            .get(cursor..)
            .ok_or(Error::InvalidArgument("invalid quote match offset"))?,
    ));
    Ok(js_trim(&output).into())
}
fn create(
    tx: &mut Transaction<'_>,
    content: &str,
    opts: &MarkdownOptions,
    options: &MacroMarkdownOptions,
) -> Result<Option<NodeKey>> {
    let content = normalized(content)?;
    if content.is_empty() {
        return Ok(None);
    }
    let quote = tx.create(QuoteNode {})?;
    convert_from_markdown_string(
        tx,
        &content,
        &registry(true, options)?,
        Some(quote.key()),
        opts,
    )?;
    Ok(Some(quote.key()))
}
pub(super) fn after_start(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    lines: &[String],
    root: NodeKey,
    index: usize,
    start: &Match,
    options: &MacroMarkdownOptions,
) -> Result<AfterStartMatch> {
    let tags = RegexMatcher::new("</?blockquote\\b[^>]*>", "i")?;
    let mut depth = 1i32;
    let mut content = Vec::new();
    for (line_index, line) in lines.iter().enumerate().skip(index) {
        let line = if line_index == index {
            start.get(1).unwrap_or("")
        } else {
            line
        };
        let units: Vec<_> = line.encode_utf16().collect();
        let mut cursor = 0;
        let mut text = String::new();
        for m in tags.find_all(line) {
            let closing = m.full().starts_with("</");
            depth += if closing { -1 } else { 1 };
            if closing && depth == 0 {
                text.push_str(&String::from_utf16_lossy(
                    units
                        .get(cursor..m.index.get() as usize)
                        .ok_or(Error::InvalidArgument("invalid quote match offset"))?,
                ));
                content.push(text);
                if let Some(quote) = create(tx, &content.join("\n"), opts, options)? {
                    tx.append(root, &[quote])?;
                    return Ok(AfterStartMatch::Done {
                        imported: true,
                        last_line: line_index,
                    });
                }
                return Ok(AfterStartMatch::Skip);
            }
            text.push_str(&String::from_utf16_lossy(
                units
                    .get(cursor..m.end().get() as usize)
                    .ok_or(Error::InvalidArgument("invalid quote match offset"))?,
            ));
            cursor = m.end().get() as usize;
        }
        text.push_str(&String::from_utf16_lossy(
            units
                .get(cursor..)
                .ok_or(Error::InvalidArgument("invalid quote match offset"))?,
        ));
        content.push(text);
    }
    Ok(AfterStartMatch::Skip)
}
#[expect(
    clippy::too_many_arguments,
    reason = "Forward the upstream multiline callback and explicit host options"
)]
pub(super) fn replace(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    root: NodeKey,
    children: Option<&[NodeKey]>,
    start: &Match,
    end: Option<&Match>,
    lines: Option<Vec<String>>,
    options: &MacroMarkdownOptions,
) -> Result<ReplaceResult> {
    let quote = if let Some(children) = children.filter(|c| !c.is_empty()) {
        let quote = tx.create(QuoteNode {})?;
        tx.append(quote, children)?;
        quote.key()
    } else {
        let mut content = vec![start.get(1).unwrap_or("").into()];
        content.extend(lines.unwrap_or_default());
        content.push(end.and_then(|m| m.get(1)).unwrap_or("").into());
        let Some(quote) = create(tx, &content.join("\n"), opts, options)? else {
            return Ok(ReplaceResult::NotHandled);
        };
        quote
    };
    tx.append(root, &[quote])?;
    Ok(ReplaceResult::Handled)
}
pub(super) fn macro_export(
    cx: &mut ExportCx<'_>,
    node: NodeKey,
    options: &MacroMarkdownOptions,
) -> Result<Option<String>> {
    let Some(block) = cx.state().get::<ClassedBlockNode>(node) else {
        return Ok(None);
    };
    if !block.classes.iter().any(|class| class == "macro_quote") {
        return Ok(None);
    }
    let metadata = to_js_json_string(&json!({"tag":block.tag,"classes":block.classes}));
    let content = convert_to_markdown_string(
        &cx.state(),
        &registry(false, options)?,
        Some(node),
        cx.options(),
    )?;
    Ok(Some(format!(
        "<m-email-thread-embed>{metadata}{}</m-email-thread-embed>",
        content.replace('\n', "\\n")
    )))
}
pub(super) fn macro_replace(
    tx: &mut Transaction<'_>,
    opts: &MarkdownOptions,
    parent: NodeKey,
    m: &Match,
    options: &MacroMarkdownOptions,
) -> Result<ReplaceResult> {
    let attempt = (|| -> Result<NodeKey> {
        let regex = RegexMatcher::new("<m-email-thread-embed>({.*?})", "")?;
        let metadata = regex
            .exec(m.full())
            .ok_or(Error::InvalidArgument("missing quote metadata"))?;
        let value: serde_json::Value = serde_json::from_str(metadata.get(1).unwrap_or(""))
            .map_err(lexical_model::Error::from)?;
        if !matches!(
            value["tag"].as_str(),
            Some("div" | "p" | "span" | "blockquote")
        ) || !value["classes"].is_array()
        {
            return Err(Error::InvalidArgument("invalid quote metadata"));
        }
        let block = tx.create(ClassedBlockNode::import_json(
            value
                .as_object()
                .ok_or(Error::InvalidArgument("quote metadata"))?,
        )?)?;
        let content = m
            .full()
            .strip_prefix(metadata.full())
            .and_then(|text| text.strip_suffix("</m-email-thread-embed>"))
            .ok_or(Error::InvalidArgument("quote envelope"))?;
        convert_from_markdown_string(
            tx,
            &content.replace("\\n", "\n"),
            &registry(false, options)?,
            Some(block.key()),
            opts,
        )?;
        Ok(block.key())
    })();
    let key = match attempt {
        Ok(key) => key,
        Err(_) => {
            let unknown = envelope::unknown(tx, "Unknown Email Thread")?;
            let p = tx.create(Paragraph {})?;
            tx.append(p, &[unknown])?;
            p.key()
        }
    };
    tx.replace(parent, key, false)?;
    Ok(ReplaceResult::Handled)
}
