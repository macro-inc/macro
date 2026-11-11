//! Shared tail of Source DiffNode.handleAccept and $convertPasteToText:
//! import markdown into an element, unwrap it and select its former last child.
use super::*;
use crate::NodeHost;

/// `$convertFromMarkdownString(markdown, ALL_TRANSFORMERS, element, false)`,
/// then `$unwrapNode(element)` and `lastChild.selectEnd()`.
pub(super) fn import_unwrap_select(
    tx: &mut Transaction<'_>,
    element: NodeKey,
    markdown: &str,
) -> Result<(), Error> {
    let options = crate::transformers::MacroMarkdownOptions {
        app_hostname: tx
            .try_extension::<NodeHost>()
            .and_then(|host| host.0.clone()),
    };
    let transformers = crate::transformers::transformers("all", &options)
        .map_err(|error| Error::invariant(format!("Macro transformer list: {error}")))?;
    lexical_markdown::convert_from_markdown_string(
        tx,
        markdown,
        &transformers,
        Some(element),
        &lexical_markdown::MarkdownOptions::default(),
    )
    .map_err(|error| Error::invariant(format!("Markdown import: {error}")))?;
    let last = tx.last_child(element);
    lexical_rich_nodes::utils::unwrap_node(tx, element)?;
    if let Some(last) = last {
        tx.select_end(last)?;
    }
    Ok(())
}
