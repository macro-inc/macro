use crate::api::context::ApiContext;
use anyhow::{Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use macro_db_client::dcs::get_document_text::{
    get_document_texts_with_no_tokens, get_pdf_docx_document_text,
};
use macro_db_client::dcs::upsert_document_text::upsert_document_text;

pub async fn count_tokens_handler(
    State(state): State<ApiContext>,
) -> Result<(StatusCode, String), (StatusCode, String)> {
    tokio::spawn(recount_documents_with_no_tokens(state));

    Ok((
        StatusCode::OK,
        "spawned task to recount documents with no tokens".to_string(),
    ))
}

#[tracing::instrument(err, skip(ctx))]
pub async fn recount_documents_with_no_tokens(ctx: ApiContext) -> Result<()> {
    let document_text_with_no_tokens = get_document_texts_with_no_tokens(ctx.db.clone())
        .await
        .context("failed to get document text with no tokens")?;

    let documents_length = document_text_with_no_tokens.len();

    tracing::debug!(documents_length, "found documents with no tokens");

    for document_id in document_text_with_no_tokens {
        tracing::debug!(document_id, "starting to re-count tokens for document");

        let document_text = get_pdf_docx_document_text(ctx.db.clone(), &document_id)
            .await
            .context("failed to get document text")?;

        let token_count = ai::tokens::count_tokens(&document_text.content)
            .context("failed to count tokens for document")?;

        tracing::debug!(
            document_id = document_text.document_id,
            token_count,
            "finished re-counting tokens for document"
        );

        upsert_document_text(
            &ctx.db,
            &document_text.document_id,
            &document_text.content,
            token_count,
        )
        .await
        .context("failed to upsert document text")?;
    }

    Ok(())
}
