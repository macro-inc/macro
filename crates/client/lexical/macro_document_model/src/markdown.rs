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

