//! Package conversion entry points retain typed callback errors.
pub(crate) mod parser;
use crate::Result;
use lexical_markdown::{MarkdownOptions, Transformers};
use lexical_model::{NodeKey, Read, Transaction};
/// Export with an already configured ordered transformer list.
pub fn convert_to_markdown_string(
    state: &impl Read,
    transformers: &Transformers,
    root: Option<NodeKey>,
    options: &MarkdownOptions,
) -> Result<String> {
    Ok(lexical_markdown::convert_to_markdown_string(
        state,
        transformers,
        root,
        options,
    )?)
}
/// Import with an already configured ordered transformer list.
pub fn convert_from_markdown_string(
    tx: &mut Transaction<'_>,
    text: &str,
    transformers: &Transformers,
    root: Option<NodeKey>,
    options: &MarkdownOptions,
) -> Result<()> {
    Ok(lexical_markdown::convert_from_markdown_string(
        tx,
        text,
        transformers,
        root,
        options,
    )?)
}

/// Parse authored markdown in the source headless editor and assign durable node ids.
pub fn markdown_to_serialized_editor_state_with_ids(
    markdown: &str,
    context: &crate::DocumentContext,
) -> Result<lexical_model::SerializedEditorState> {
    let mut editor = context.builder().build()?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    let options = MarkdownOptions {
        list_indent: 2,
        ..Default::default()
    };
    editor.try_update(Default::default(), |tx| {
        convert_from_markdown_string(tx, markdown, &transformers, None, &options)
    })?;
    editor.update(|tx| {
        crate::node_ids::update_all_node_ids(
            tx,
            &mut crate::node_ids::NodeIdMappings::default(),
            None,
        )
    })?;
    Ok(editor.state().to_json()?)
}
/// Import a stored state and export it through the source headless combined list.
pub fn serialized_editor_state_to_markdown(
    state: &lexical_model::SerializedEditorState,
    context: &crate::DocumentContext,
) -> Result<String> {
    let mut editor = context.builder().build()?;
    let parsed = editor.parse_editor_state(state)?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    convert_to_markdown_string(
        &parsed,
        &transformers,
        None,
        &MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )
}
/// Parse markdown into a headless editor using the same combined-list options as source utilities.
pub fn editor_from_markdown(
    markdown: &str,
    context: &crate::DocumentContext,
) -> Result<lexical_model::Editor> {
    let mut editor = context.builder().build()?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    editor.try_update(Default::default(), |tx| {
        convert_from_markdown_string(
            tx,
            markdown,
            &transformers,
            None,
            &MarkdownOptions {
                list_indent: 2,
                ..Default::default()
            },
        )
    })?;
    Ok(editor)
}
