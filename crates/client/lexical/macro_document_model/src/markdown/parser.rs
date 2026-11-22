//! Registry-only Markdown parsing shared by application input adapters.
use crate::{
    NodeClock, NodeHost, NodeRandom,
    transformers::{self, MacroMarkdownOptions},
};
use lexical_markdown::{MarkdownOptions, Transformer, Transformers};
use lexical_model::{Editor, EditorMode, Error, SerializedEditorState, Transaction};

/// Parse through the current preset's classes and filtered source transformer list.
/// Constructor capabilities share the live transaction's continuing host services.
/// This preserves native preset behavior only. Named JavaScript plugins must use
/// their actual registered classes and ordered transformer configuration; this
/// preset is neither a fallback nor a way to satisfy their dependencies.
pub(crate) fn parse_for_preset(
    tx: &Transaction<'_>,
    ty: crate::EditorType,
    text: &str,
) -> Result<SerializedEditorState, Error> {
    let mut builder =
        crate::editor::register_preset_nodes(Editor::builder(EditorMode::Headless), ty);
    if let Some(clock) = tx.try_extension::<NodeClock>() {
        builder = builder.extension_state(clock.clone());
    }
    if let Some(random) = tx.try_extension::<NodeRandom>() {
        builder = builder.extension_state(random.clone());
    }
    if let Some(host) = tx.try_extension::<NodeHost>() {
        builder = builder.extension_state(host.clone());
    }
    let mut parser = builder
        .build()
        .map_err(|error| Error::invariant(format!("Markdown parser registry: {error}")))?;
    let options = MacroMarkdownOptions {
        app_hostname: tx
            .try_extension::<NodeHost>()
            .and_then(|host| host.0.clone()),
    };
    let names =
        transformers::list_names("all").ok_or(Error::Invariant("Macro transformer list"))?;
    let mut callbacks = Vec::new();
    let mut preserve = false;
    for name in names {
        let callback = transformers::transformer(name, &options)
            .map_err(|error| Error::invariant(format!("Markdown transformer: {error}")))?;
        let dependencies = match &callback {
            Transformer::Element(callback) => callback.dependencies(),
            Transformer::MultilineElement(callback) => callback.dependencies(),
            Transformer::TextMatch(callback) => callback.dependencies(),
            Transformer::TextFormat(_) => &[],
        };
        if dependencies
            .iter()
            .all(|name| parser.registry().get(name).is_some())
        {
            preserve |= *name == "PRESERVE_LINES";
            callbacks.push(callback);
        }
    }
    let text = transformers::protect_empty_paragraph_lines(text, preserve);
    let callbacks = Transformers::new(callbacks);
    parser.update(|tx| {
        lexical_markdown::convert_from_markdown_string(
            tx,
            &text,
            &callbacks,
            None,
            &MarkdownOptions {
                list_indent: 2,
                ..MarkdownOptions::default()
            },
        )
        .map_err(|error| Error::invariant(format!("Markdown paste: {error}")))
    })?;
    parser.state().to_json()
}
