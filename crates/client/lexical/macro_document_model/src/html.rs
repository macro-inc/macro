//! Owned headless HTML export matching the lexical-service email body route.
use crate::{DocumentContext, Result};
use lexical_html::*;
use lexical_model::NodeKey;
/// htmlparser2-compatible template fragment tokenizer and tree builder.
pub mod fragment;
mod nodes;
/// Source options: patched two-space Markdown lists and an empty headless theme.
#[derive(Clone, Debug)]
pub struct MarkdownToHtmlOptions {
    /// Ordered Markdown import options.
    pub markdown: lexical_markdown::MarkdownOptions,
    /// Headless theme classes.
    pub theme: EditorTheme,
}
impl Default for MarkdownToHtmlOptions {
    fn default() -> Self {
        Self {
            markdown: lexical_markdown::MarkdownOptions {
                list_indent: 2,
                ..Default::default()
            },
            theme: EditorTheme::default(),
        }
    }
}
/// HTML and plain text alternatives for a message body.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RenderedBody {
    /// Exported markup.
    pub html: String,
    /// Root text content, retaining block separators.
    pub text: String,
}
/// Build every exact stored Macro and upstream HTML class implementation.
pub fn macro_export_registry() -> ExportRegistry {
    let mut builder = lexical_rich_nodes::html::register_rich_nodes_html(register_core(
        ExportRegistry::builder(),
    ));
    for ty in crate::supported_node_types() {
        if !matches!(
            ty,
            "code"
                | "code-highlight"
                | "heading"
                | "quote"
                | "link"
                | "autolink"
                | "list"
                | "listitem"
                | "tab"
                | "table"
                | "tablerow"
                | "tablecell"
                | "mark"
        ) {
            builder = builder.override_export(ty, nodes::export);
        }
    }
    builder.build()
}
/// Import through the replacement-enabled editor, then export immutable HTML and text.
pub fn markdown_to_html(
    markdown: &str,
    options: &MarkdownToHtmlOptions,
    context: &DocumentContext,
) -> Result<RenderedBody> {
    let mut editor = context.builder().build()?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    editor.try_update(Default::default(), |tx| {
        crate::markdown::convert_from_markdown_string(
            tx,
            markdown,
            &transformers,
            None,
            &options.markdown,
        )
    })?;
    Ok(RenderedBody {
        html: HtmlExporter::new(macro_export_registry(), options.theme.clone())
            .generate_html_from_nodes(editor.state(), None)?,
        text: editor
            .state()
            .view()
            .text_content(NodeKey::ROOT)
            .into_owned(),
    })
}
