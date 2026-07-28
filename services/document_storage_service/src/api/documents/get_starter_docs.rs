use crate::api::context::AuthorizationService;
use crate::api::documents::initialize_starter_docs::HOW_TO_GUIDE_NAME;
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_db_client::document::get_user_documents_by_names;
use model::response::{GenericErrorResponse, GenericResponse};
use sqlx::PgPool;
use utoipa::ToSchema;

/// The starter documents seeded at signup, so clients can open them by id
/// instead of guessing which document is which by name.
#[derive(serde::Serialize, ToSchema)]
pub struct StarterDocumentsResponse {
    /// Id of the user's "Macro how to guide", when it still exists.
    pub how_to_guide_id: Option<String>,
}

/// Resolves the current user's starter documents.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/starter_docs",
    responses(
        (status = 200, body = StarterDocumentsResponse),
        (status = 401, body = GenericErrorResponse),
        (status = 500, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(db, user), fields(user_id=?user.authorization.user.macro_user_id))]
#[axum::debug_handler(state = crate::api::context::ApiContext)]
pub async fn handler(
    State(db): State<PgPool>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Response {
    let names = [HOW_TO_GUIDE_NAME.to_string()];
    let documents = match get_user_documents_by_names(
        &db,
        user.authorization.user.macro_user_id.as_ref(),
        &names,
    )
    .await
    {
        Ok(documents) => documents,
        Err(e) => {
            tracing::error!(error=?e, "failed to look up starter documents");
            return GenericResponse::builder()
                .message("failed to look up starter documents")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Exact indexed lookup, unbounded by document count; the oldest match
    // wins a name collision — that's the seeded guide.
    let how_to_guide_id = documents
        .into_iter()
        .next()
        .map(|document| document.document_id);

    (
        StatusCode::OK,
        Json(StarterDocumentsResponse { how_to_guide_id }),
    )
        .into_response()
}
