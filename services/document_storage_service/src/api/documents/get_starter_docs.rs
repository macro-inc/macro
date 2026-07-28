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
    /// Whether the user has opened the guide since it was seeded. Computed
    /// from the history row's timestamps (`updatedAt > createdAt`): seeding
    /// writes the row with the two equal, so membership alone would read as
    /// opened — and the row must stay, it feeds the command menu's recents.
    pub how_to_guide_opened: bool,
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

    // Best-effort: the id is this endpoint's contract; the opened flag is a
    // hint the checklist latches, so a failed lookup degrades to false
    // rather than failing the request.
    let how_to_guide_opened = match &how_to_guide_id {
        Some(id) => macro_db_client::history::user_history_item_opened(
            &db,
            user.authorization.user.macro_user_id.as_ref(),
            id,
            "document",
        )
        .await
        .inspect_err(|e| tracing::warn!(error=?e, "failed to look up guide history"))
        .ok()
        .flatten()
        .unwrap_or(false),
        None => false,
    };

    (
        StatusCode::OK,
        Json(StarterDocumentsResponse {
            how_to_guide_id,
            how_to_guide_opened,
        }),
    )
        .into_response()
}
