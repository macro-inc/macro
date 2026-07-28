use crate::api::context::AuthorizationService;
use crate::api::documents::initialize_starter_docs::{HOW_TO_GUIDE_NAME, starter_doc_id};
use axum::Json;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::GenericErrorResponse;
use utoipa::ToSchema;

/// The deterministic starter document ids for the current user.
#[derive(serde::Serialize, ToSchema)]
pub struct StarterDocumentsResponse {
    /// Id of the user's "Macro how to guide".
    pub how_to_guide_id: String,
}

/// Resolves the current user's starter documents.
#[utoipa::path(
    tag = "document",
    get,
    path = "/documents/starter_docs",
    responses(
        (status = 200, body = StarterDocumentsResponse),
        (status = 401, body = GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(user), fields(user_id=?user.authorization.user.macro_user_id))]
#[axum::debug_handler(state = crate::api::context::ApiContext)]
pub async fn handler(
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Json<StarterDocumentsResponse> {
    Json(StarterDocumentsResponse {
        how_to_guide_id: starter_doc_id(&user.authorization.user.macro_user_id, HOW_TO_GUIDE_NAME)
            .to_string(),
    })
}
