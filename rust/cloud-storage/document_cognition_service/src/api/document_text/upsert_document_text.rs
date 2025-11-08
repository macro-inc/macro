use crate::model::request::document_text::CreateTextRequestBody;
use anyhow::Result;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use macro_db_client::dcs::upsert_document_text::upsert_document_text;
use sqlx::PgPool;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

#[utoipa::path(
        post,
        path = "/document_text/:document_id",
        params(
            ("document_id" = String, Path, description = "Id of the document to create text for")
        ),
        responses(
            (status = 201),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db), fields(document_id=?document_id))]
pub async fn upsert_text_handler(
    State(db): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
    Json(req): Json<CreateTextRequestBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token_count = ai::tokens::count_tokens(&req.content).map_err(|e| {
        tracing::error!(error = %e, document_id, "failed to count tokens");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to count tokens".to_string(),
        )
    })?;

    upsert_document_text(&db, &document_id, &req.content, token_count)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, document_id, "failed to upsert document text");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to create document text".to_string(),
            )
        })?;

    Ok(StatusCode::CREATED)
}
