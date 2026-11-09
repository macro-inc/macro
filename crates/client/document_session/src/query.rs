//! Shared portable export queries for all session host boundaries.
use lexical_model::*;
/// Portable Markdown indentation policy.
#[derive(Clone, Copy, Debug)]
pub enum MarkdownFlavor {
    /// Upstream Lexical four-space lists.
    Upstream,
    /// Application two-space lists.
    Application,
}
/// A portable export failed.
#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    /// Native HTML export failure.
    #[error(transparent)]
    Html(#[from] lexical_html::Error),
    /// Native Markdown conversion failure.
    #[error(transparent)]
    Markdown(#[from] lexical_markdown::Error),
}
/// Export the whole editor or current selection as portable Markdown.
pub fn export_markdown(
    state: &EditorState,
    flavor: MarkdownFlavor,
    selected: bool,
) -> Result<String, QueryError> {
    let list_indent = match flavor {
        MarkdownFlavor::Upstream => 4,
        MarkdownFlavor::Application => 2,
    };
    let options = lexical_markdown::MarkdownOptions {
        list_indent,
        ..Default::default()
    };
    if selected {
        Ok(lexical_markdown::convert_selection_to_markdown_string(
            state,
            &lexical_markdown::builtin::TRANSFORMERS,
            state.selection(),
            &options,
        )?)
    } else {
        Ok(lexical_markdown::convert_to_markdown_string(
            state,
            &lexical_markdown::builtin::TRANSFORMERS,
            None,
            &options,
        )?)
    }
}
/// Export the whole editor or current selection as portable HTML.
pub fn export_html(state: &EditorState, selected: bool) -> Result<String, QueryError> {
    export_html_for_selection(state, if selected { state.selection() } else { None })
}
/// Export HTML for explicit model endpoints, shared by native and WASM clipboard hosts.
pub fn export_html_for_selection(
    state: &EditorState,
    selection: Option<&Selection>,
) -> Result<String, QueryError> {
    let registry = lexical_html::register_core(lexical_html::ExportRegistry::builder());
    let registry = [
        "heading",
        "quote",
        "link",
        "autolink",
        "list",
        "listitem",
        "code",
        "code-highlight",
        "mark",
        "table",
        "tablerow",
        "tablecell",
    ]
    .into_iter()
    .fold(registry, |registry, name| {
        registry.override_export(name, rich_html)
    })
    .build();
    Ok(
        lexical_html::HtmlExporter::new(registry, lexical_html::EditorTheme::default())
            .generate_html_from_nodes(state, selection)?,
    )
}
fn rich_html<'a>(
    ctx: &lexical_html::ExportCtx<'a>,
    key: NodeKey,
) -> lexical_html::Result<lexical_html::DomExportOutput<'a>> {
    use lexical_html::{DomExportOutput, HtmlElement};
    let node = ctx.state.view().export_json(key)?;
    let kind = node
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if kind == "code-highlight" {
        return Ok(DomExportOutput::node(lexical_html::nodes::text_export_dom(
            ctx,
            key,
            lexical_html::nodes::text_create_dom(ctx, key)?,
        )?));
    }
    let tag = match kind {
        "heading" => node
            .get("tag")
            .and_then(serde_json::Value::as_str)
            .filter(|tag| matches!(*tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"))
            .unwrap_or("h1"),
        "quote" => "blockquote",
        "link" | "autolink" => "a",
        "list" => {
            if node.get("listType").and_then(serde_json::Value::as_str) == Some("number") {
                "ol"
            } else {
                "ul"
            }
        }
        "listitem" => "li",
        "code" => "pre",
        "mark" => "mark",
        "table" => "table",
        "tablerow" => "tr",
        "tablecell" => {
            if node
                .get("headerState")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0)
                > 0
            {
                "th"
            } else {
                "td"
            }
        }
        _ => "span",
    };
    let mut element = HtmlElement::new(tag);
    if tag == "a" {
        let url = node
            .get("url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let safe = lexical_rich_nodes::link::sanitize_url(url);
        element.set_attribute("href", safe);
        for attribute in ["target", "rel", "title"] {
            if let Some(value) = node.get(attribute).and_then(serde_json::Value::as_str) {
                element.set_attribute(attribute, value);
            }
        }
    }
    if tag == "ol"
        && let Some(start) = node.get("start").and_then(serde_json::Value::as_u64)
    {
        element.set_attribute("start", start.to_string());
    }
    if matches!(tag, "td" | "th") {
        for (key, attribute) in [("colSpan", "colspan"), ("rowSpan", "rowspan")] {
            if let Some(span) = node
                .get(key)
                .and_then(serde_json::Value::as_u64)
                .filter(|v| *v > 1)
            {
                element.set_attribute(attribute, span.to_string());
            }
        }
    }
    if ctx.state.view().is_element(key) {
        lexical_html::nodes::element_export_dom(ctx, key, &mut element)?;
    }
    Ok(DomExportOutput::element(element))
}
