use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Deletes a given document from the open search index
#[tracing::instrument(skip(ctx, _internal_authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Path(Params { document_id }): extract::Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("delete document request initiated");

    ctx.opensearch_client
        .delete_document(&document_id, None)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to delete document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to delete document",
            )
                .into_response()
        })?;

    todo!()
}
