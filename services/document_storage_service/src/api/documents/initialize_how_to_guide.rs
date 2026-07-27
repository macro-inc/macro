use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::State,
    response::{IntoResponse, Json, Response},
};
use documents_hex::domain::create::{
    MarkdownSubtype, NewDocumentMetadata, NewMarkdownTextDocument,
};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use favorites::domain::ports::FavoritesService;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{ErrorResponse, GenericSuccessResponse};
use model_entity::EntityType;
use reqwest::StatusCode;

const HOW_TO_GUIDE_NAME: &str = "Macro how to guide";
const HOW_TO_GUIDE_TEMPLATE: &str = include_str!("./template/macro_how_to_guide.md");

/// Creates the "Macro how to guide" markdown document for the user and pins it
/// to their sidebar favorites. Called by the authentication service when a new
/// user signs up.
#[tracing::instrument(skip(state, user_context), fields(user_id=?user_context.authorization.user.macro_user_id))]
pub async fn handler(
    State(state): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    tracing::info!("initialize how to guide");

    let created = state
        .documents_state
        .creator
        .create_markdown_text(
            user_context.authorization.user.macro_user_id.clone(),
            NewMarkdownTextDocument {
                metadata: NewDocumentMetadata::builder(HOW_TO_GUIDE_NAME).build(),
                markdown: HOW_TO_GUIDE_TEMPLATE.to_string(),
                subtype: MarkdownSubtype::Note,
            },
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to create how to guide document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to create how to guide document".into(),
                }),
            )
                .into_response()
        })?;

    let receipt = state
        .entity_access_service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user_context.authorization.user.macro_user_id,
            user_context
                .authorization
                .user
                .user_context
                .organization_id
                .map(i64::from),
            created.document_id(),
            EntityType::Document,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to authorize how to guide document favorite");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to favorite how to guide document".into(),
                }),
            )
                .into_response()
        })?;

    state
        .favorites_service
        .add_favorite(&receipt)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to favorite how to guide document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "failed to favorite how to guide document".into(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response())
}
