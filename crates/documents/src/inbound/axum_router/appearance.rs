//! Document presentation updates use the same checked edit receipt as metadata edits.

use axum::{Json, extract::State};
use entity_access::{
    domain::ports::EntityAccessService, inbound::axum_extractors::DocumentAccessExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model_entity::EntityAppearance;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::{models::DocumentError, ports::DocumentService};

/// Replace a document's presentation overrides without editing its content.
#[utoipa::path(
    put,
    path = "/documents/{document_id}/appearance",
    tag = "document",
    params(("document_id" = String, Path, description = "Document ID")),
    operation_id = "set_document_appearance",
    request_body = EntityAppearance,
    responses((status = 200, body = EntityAppearance), (status = 400), (status = 403), (status = 404))
)]
#[tracing::instrument(err, skip(state, access))]
pub async fn set_appearance<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: DocumentAccessExtractor<EditAccessLevel, Svc, Auth>,
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    Json(appearance): Json<EntityAppearance>,
) -> Result<Json<EntityAppearance>, DocumentError> {
    state
        .service
        .set_appearance(access.entity_access_receipt, appearance)
        .await
        .map(Json)
}
