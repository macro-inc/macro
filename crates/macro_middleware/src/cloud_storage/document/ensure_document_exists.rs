use crate::error_handler::error_handler;
use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use model::document::DocumentBasic;
use serde::Deserialize;
use sqlx::{PgPool, Pool, Postgres};

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Finds the requested document and returns the basic document information to be used in the
/// request context
#[tracing::instrument(skip(db))]
pub(in crate::cloud_storage::document) async fn get_basic_document(
    db: &Pool<Postgres>,
    document_id: &str,
) -> Result<DocumentBasic, (StatusCode, String)> {
    let result: DocumentBasic = macro_db_client::document::get_basic_document(db, document_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get document");
            if e.to_string()
                .contains("no rows returned by a query that expected to return at least one row")
            {
                return (
                    StatusCode::NOT_FOUND,
                    format!("document with id \"{}\" was not found", document_id),
                );
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unknown error occurred".to_string(),
            )
        })?;

    Ok(result)
}

/// Validates the document exists and inserts DocumentBasic into req context
pub async fn handler(
    State(db): State<PgPool>,
    Path(Params { document_id }): Path<Params>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let document = get_basic_document(&db, &document_id)
        .await
        .map_err(|(status_code, msg)| error_handler(&msg, status_code))?;

    req.extensions_mut().insert(document);
    Ok(next.run(req).await)
}
