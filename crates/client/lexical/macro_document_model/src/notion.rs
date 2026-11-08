//! Import Notion enhanced Markdown with reference resolution and durable ids.
use crate::{DocumentContext, nodes::*};
use lexical_markdown::{Error, Result};
use lexical_markdown::{matcher::*, *};
use lexical_model::*;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};
mod block;
mod inline;
/// Known page and person mappings, keyed by lowercase dashless Notion ids.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NotionLinks {
    /// Imported pages.
    pub pages: BTreeMap<String, NotionPageLink>,
    /// Known people.
    pub users: BTreeMap<String, NotionUserLink>,
}
/// The document created for one imported page.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionPageLink {
    /// Destination document identifier, verbatim.
    pub document_id: String,
    /// Page title.
    pub name: String,
}
/// A known principal matching a Notion person.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionUserLink {
    /// Principal identifier, verbatim.
    pub user_id: String,
    /// Email used by the mention display.
    pub email: String,
}
fn regex(source: &str) -> RegexMatcher {
    RegexMatcher::new(source, "").expect("literal Notion pattern")
}
fn attrs(raw: &str) -> BTreeMap<String, String> {
    regex(r#"([\w-]+)="([^"]*)""#)
        .find_all(raw)
        .iter()
        .map(|m| {
            (
                m.get(1).unwrap_or("").into(),
                m.get(2)
                    .unwrap_or("")
                    .replace("&quot;", "\"")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&amp;", "&"),
            )
        })
        .collect()
}
fn without_tags(text: &str) -> String {
    let mut output = text.to_owned();
    // Matches from the original string, in reverse, preserve UTF-8 positions.
    let pattern = regress::Regex::new("<[^>]+>").expect("literal tag regex");
    for found in pattern
        .find_iter(text)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        output.replace_range(found.range(), "");
    }
    js_trim(&output).into()
}
fn web_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}
fn notion_ids(reference: &str) -> Vec<String> {
    regex(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}")
        .find_all(reference)
        .iter()
        .rev()
        .map(|m| m.full().replace('-', "").to_lowercase())
        .collect()
}
fn fence(line: &str) -> Option<String> {
    regex(r"^\s*(`{3,}|~{3,})")
        .exec(line)
        .and_then(|m| m.get(1).map(str::to_owned))
}
/// Drop blank separators while retaining structural indentation and escaped checkboxes.
pub fn notion_lines(markdown: &str) -> String {
    let mut output = Vec::new();
    let mut active_fence = None::<String>;
    for raw in markdown.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        let marker = fence(line);
        if let Some(active) = &active_fence {
            output.push(line.to_owned());
            if marker
                .as_ref()
                .is_some_and(|marker| marker.starts_with(active))
            {
                active_fence = None;
            }
            continue;
        }
        if marker.is_some() {
            active_fence = marker;
            output.push(line.to_owned());
            continue;
        }
        if js_trim(line).is_empty() {
            continue;
        }
        if let Some(m) = regex(r"^(\s*)(?:-\s+)?\\\[([ xX])\\\](.*)$").exec(line) {
            output.push(format!(
                "{}- [{}]{}",
                m.get(1).unwrap_or(""),
                m.get(2).unwrap_or("").to_lowercase(),
                m.get(3).unwrap_or("")
            ));
        } else if regex(r"^\s*(?:[-*+]|\d+[.)])\s").exec(line).is_some() {
            output.push(line.into());
        } else {
            output.push(line.trim_start_matches(is_js_whitespace).into());
        }
    }
    output.join("\n")
}
fn registry(
    links: &NotionLinks,
    options: &crate::transformers::MacroMarkdownOptions,
) -> Result<Transformers> {
    let mut out = vec![Transformer::MultilineElement(Arc::new(block::Container {
        pattern: regex(
            r"^\s*<(details|callout|columns|column|synced_block|synced_block_reference|ancestor-path|table)\b([^>]*?)>",
        ),
        links: links.clone(),
        options: options.clone(),
    }))];
    for (kind, pattern) in [
        (0, r"^\s*<empty-block\s*/?>\s*$"),
        (1, r"^\s*<(?:table_of_contents|custom-block)\b[^>]*/?>\s*$"),
        (2, r"^\s*<image\b([^>]*?)(?:/>|>(.*?)</image>)\s*$"),
    ] {
        out.push(Transformer::Element(Arc::new(block::Element {
            kind,
            pattern: regex(pattern),
        })));
    }
    out.extend(inline::transformers(links));
    for name in crate::transformers::list_names("all")
        .ok_or(Error::InvalidArgument("combined transformer list"))?
    {
        out.push(crate::transformers::transformer(name, options)?);
    }
    Ok(Transformers::new(out))
}
fn import_nodes(
    tx: &mut Transaction<'_>,
    markdown: &str,
    links: &NotionLinks,
    options: &crate::transformers::MacroMarkdownOptions,
) -> Result<Vec<NodeKey>> {
    let scratch = tx.create(Paragraph {})?;
    convert_from_markdown_string(
        tx,
        markdown,
        &registry(links, options)?,
        Some(scratch.key()),
        &MarkdownOptions {
            list_indent: 2,
            should_preserve_new_lines: true,
            ..Default::default()
        },
    )?;
    Ok(tx.children_keys(scratch)?)
}
/// Convert enhanced Markdown using real node factories, then assign ids in document order.
pub fn notion_markdown_to_serialized_editor_state(
    markdown: &str,
    links: &NotionLinks,
    context: &DocumentContext,
) -> crate::Result<SerializedEditorState> {
    let mut editor = context.builder().build()?;
    let transformers = registry(links, &context.markdown_options())?;
    editor.try_update(Default::default(), |tx| {
        convert_from_markdown_string(
            tx,
            &notion_lines(markdown),
            &transformers,
            None,
            &MarkdownOptions {
                list_indent: 2,
                should_preserve_new_lines: true,
                ..Default::default()
            },
        )
    })?;
    editor.update(|tx| crate::node_ids::update_all_node_ids(tx, &mut Default::default(), None))?;
    Ok(editor.state().to_json()?)
}
