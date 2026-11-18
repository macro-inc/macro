use lexical_markdown::MarkdownOptions;
use lexical_model::*;
use macro_document_model::{Result, markdown::convert_to_markdown_string};
/// Generated image metadata used by channel Markdown.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireImageInput {
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
pub fn compose_source_image(
    image: &WireImageInput,
    context: &macro_document_model::DocumentContext,
) -> Result<String> {
    let mut editor = context.builder().build()?;
    editor.update(|tx| {
        let node = macro_document_model::nodes::create_image_node(
            tx,
            macro_document_model::nodes::CreateMedia {
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
    let transformers =
        macro_document_model::transformers::transformers("all", &context.markdown_options())?;
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
