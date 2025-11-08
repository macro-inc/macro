use crate::api::context::ApiContext;
use ai::tokens::count_tokens;
use anyhow::{Context, Error};
use macro_db_client::dcs::get_document_text::get_pdf_docx_token_count;
use model::document::FileType;

#[tracing::instrument(err, skip(ctx))]
pub async fn get_document_token_count(ctx: &ApiContext, document_id: &str) -> Result<i64, Error> {
    let document_basic = ctx
        .document_storage_client
        .get_document_basic(document_id)
        .await
        .context("Failed to fetch document basic info")?
        .ok_or_else(|| anyhow::anyhow!("document not found"))?;

    let file_type = document_basic
        .try_file_type()
        .ok_or_else(|| anyhow::anyhow!("file type not found"))?;

    if file_type == FileType::Pdf || file_type == FileType::Docx {
        return get_pdf_docx_token_count(&ctx.db, document_id)
            .await
            .context("Failed to get PDF/DOCX token count");
    }

    let document_text = ctx
        .scribe
        .document
        .fetch(document_id)
        .document_content()
        .await
        .context("Failed to fetch document content")?
        .content
        .text_content()
        .context("Failed to extract text content")?;

    let count = count_tokens(&document_text).context("Failed to count tokens")?;

    Ok(count)
}
