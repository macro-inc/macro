//! Package conversion entry points retain typed callback errors.
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
pub(crate) fn editor_from_markdown(
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

/// Generated image metadata used by channel Markdown.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMarkdownInput {
    /// Stored static file identifier.
    pub static_file_id: String,
    /// Image URL.
    pub url: String,
    /// Natural width.
    pub width: f64,
    /// Natural height.
    pub height: f64,
}
/// Compose a constrained image using the same nodes and ordered editor callbacks.
pub fn compose_image_markdown(
    image: &ImageMarkdownInput,
    context: &crate::DocumentContext,
) -> Result<String> {
    let mut editor = context.builder().build()?;
    editor.update(|tx| {
        let node = crate::nodes::create_image_node(
            tx,
            crate::nodes::CreateMedia {
                src_type: "sfs".into(),
                id: Some(image.static_file_id.clone()),
                url: Some(image.url.clone()),
                width: Some(image.width),
                height: Some(image.height),
                constrained_width: Some(400.0),
                constrained_height: Some(400.0),
                ..Default::default()
            },
            Some("Generated image".into()),
        )?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(())
    })?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    convert_to_markdown_string(
        editor.state(),
        &transformers,
        None,
        &MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )
}
