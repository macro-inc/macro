use crate::api::context::ApiContext;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use model::response::{EmptyResponse, GenericErrorResponse};

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets a particular document by its id
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/update",
        operation_id = "put_document_update",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    let res = macro_db_client::document::update::update_document(&ctx.db, &document_id).await;

    if res.is_err() {
        tracing::error!("unable to update document");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    StatusCode::OK
}
