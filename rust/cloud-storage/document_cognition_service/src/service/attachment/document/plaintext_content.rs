use crate::api::context::ApiContext;
use anyhow::{Context, Result};
use scribe::document::types::DocumentContent;

#[tracing::instrument(err, skip(ctx))]
pub async fn get_document_plaintext_content(
    ctx: &ApiContext,
    document_id: &str,
) -> Result<DocumentContent> {
    let document = ctx
        .scribe
        .document
        .fetch(document_id)
        .document_content()
        .await
        .context("Failed to fetch document content")?;

    if !document.metadata().is_text_content() {
        anyhow::bail!("Document is not text content");
    }

    Ok(document.content)
}
