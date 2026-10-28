//! Axum router for channel label endpoints.
//!
//! Every route authenticates the user and passes their optional verified team
//! receipt inward. The domain resolves team-shared or account-private scope.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::OptionalMacroUserTeamExtractorV2,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use uuid::Uuid;

use crate::domain::{
    models::{
        ChannelLabel, ChannelLabelRule, ChannelLabelsError, ChannelLabelsList,
        ChannelLabelsReceipt, NewChannelLabel, SmartTagPreview,
    },
    ports::ChannelLabelsService,
};

/// Router state for channel label endpoints.
pub struct ChannelLabelsRouterState<S, Eas, Auth> {
    service: Arc<S>,
    entity_access_service: Arc<Eas>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Eas, Auth> Clone for ChannelLabelsRouterState<S, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Eas, Auth> ChannelLabelsRouterState<S, Eas, Auth>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        entity_access_service: Arc<Eas>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            authorization_state,
        }
    }
}

impl<S, Eas, Auth> FromRef<ChannelLabelsRouterState<S, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &ChannelLabelsRouterState<S, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<S, Eas, Auth> FromRef<ChannelLabelsRouterState<S, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ChannelLabelsRouterState<S, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the channel labels router.
///
/// Routes:
/// - `GET /` — list the caller's shared or private labels.
/// - `POST /` — create a label, optionally moving channels into it.
/// - `PATCH /{label_id}` — rename a label.
/// - `DELETE /{label_id}` — delete a label.
/// - `PUT /channels/{channel_id}` — move a channel into or out of a label.
pub fn channel_labels_router<S, Eas, Auth, T>(
    state: ChannelLabelsRouterState<S, Eas, Auth>,
) -> Router<T>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/", get(list_channel_labels_handler::<S, Eas, Auth>))
        .route("/", post(create_channel_label_handler::<S, Eas, Auth>))
        .route("/preview", post(preview_smart_tag_handler::<S, Eas, Auth>))
        .route(
            "/{label_id}",
            patch(rename_channel_label_handler::<S, Eas, Auth>),
        )
        .route(
            "/{label_id}",
            delete(delete_channel_label_handler::<S, Eas, Auth>),
        )
        .route(
            "/channels/{channel_id}",
            put(set_channel_label_handler::<S, Eas, Auth>),
        )
        .with_state(state)
}

/// Request body for creating a label.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelLabelRequest {
    /// Display name; unique within the scope, case-insensitively.
    pub name: String,
    /// Automatic name-matching rule; omitted for manual labels or a name-only rename.
    #[serde(default)]
    pub rule: Option<ChannelLabelRule>,
    /// Channels to move into the new label.
    #[serde(default)]
    pub channel_ids: Vec<Uuid>,
}

/// Request body for renaming a label.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameChannelLabelRequest {
    /// New display name.
    pub name: String,
    /// Automatic name-matching rule; omitted for manual labels or a name-only rename.
    #[serde(default)]
    pub rule: Option<ChannelLabelRule>,
}

/// Request body for moving a channel between labels.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetChannelLabelRequest {
    /// The label to put the channel in, or `null` to remove it from its label.
    #[serde(default)]
    pub label_id: Option<Uuid>,
}

/// Path params naming a label.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct ChannelLabelPathParams {
    /// The label id.
    pub label_id: Uuid,
}

/// Path params naming a channel.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Path)]
pub struct ChannelLabelChannelPathParams {
    /// The channel id.
    pub channel_id: Uuid,
}

/// List the caller's shared or private labels.
#[utoipa::path(
    get,
    tag = "channel_labels",
    operation_id = "list_channel_labels",
    path = "/channel-labels",
    responses(
        (status = 200, body = ChannelLabelsList),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn list_channel_labels_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<ChannelLabelsList>, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    let labels = state.service.list_labels(&receipt).await?;
    Ok(Json(ChannelLabelsList {
        team_id: receipt.scope().team_id(),
        labels,
    }))
}

/// Create a label for the caller's authorized scope.
#[utoipa::path(
    post,
    tag = "channel_labels",
    operation_id = "create_channel_label",
    path = "/channel-labels",
    request_body = CreateChannelLabelRequest,
    responses(
        (status = 200, body = ChannelLabel),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn create_channel_label_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(req): Json<CreateChannelLabelRequest>,
) -> Result<Json<ChannelLabel>, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    let label = state
        .service
        .create_label(
            &receipt,
            NewChannelLabel {
                name: req.name,
                rule: req.rule,
                channel_ids: req.channel_ids,
            },
        )
        .await?;
    Ok(Json(label))
}

/// Rename a label of the caller's authorized scope.
#[utoipa::path(
    patch,
    tag = "channel_labels",
    operation_id = "rename_channel_label",
    path = "/channel-labels/{label_id}",
    params(ChannelLabelPathParams),
    request_body = RenameChannelLabelRequest,
    responses(
        (status = 200, body = ChannelLabel),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn rename_channel_label_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<ChannelLabelPathParams>,
    Json(req): Json<RenameChannelLabelRequest>,
) -> Result<Json<ChannelLabel>, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    let label = state
        .service
        .rename_label(&receipt, params.label_id, req.name, req.rule)
        .await?;
    Ok(Json(label))
}

/// Delete a label of the caller's authorized scope. Its channels return to the plain list.
#[utoipa::path(
    delete,
    tag = "channel_labels",
    operation_id = "delete_channel_label",
    path = "/channel-labels/{label_id}",
    params(ChannelLabelPathParams),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_channel_label_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<ChannelLabelPathParams>,
) -> Result<StatusCode, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    state
        .service
        .delete_label(&receipt, params.label_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Move a channel into a label of the caller's authorized scope, or out of any label.
#[utoipa::path(
    put,
    tag = "channel_labels",
    operation_id = "set_channel_label",
    path = "/channel-labels/channels/{channel_id}",
    params(ChannelLabelChannelPathParams),
    request_body = SetChannelLabelRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn set_channel_label_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(params): Path<ChannelLabelChannelPathParams>,
    Json(req): Json<SetChannelLabelRequest>,
) -> Result<StatusCode, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    state
        .service
        .set_channel_label(&receipt, params.channel_id, req.label_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Preview visible channels matched by a smart tag, without creating it.
#[utoipa::path(
    post,
    tag = "channel_labels",
    operation_id = "preview_smart_tag",
    path = "/channel-labels/preview",
    request_body = ChannelLabelRule,
    responses(
        (status = 200, body = SmartTagPreview),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn preview_smart_tag_handler<S, Eas, Auth>(
    State(state): State<ChannelLabelsRouterState<S, Eas, Auth>>,
    access: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Json(rule): Json<ChannelLabelRule>,
) -> Result<Json<SmartTagPreview>, ChannelLabelsError>
where
    S: ChannelLabelsService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let receipt = ChannelLabelsReceipt::from_access(
        user.authorization.macro_user_id,
        access.entity_access_receipt,
    )?;
    Ok(Json(state.service.preview_smart_tag(&receipt, rule).await?))
}

impl IntoResponse for ChannelLabelsError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            ChannelLabelsError::NotFound(_) => StatusCode::NOT_FOUND,
            ChannelLabelsError::NameTaken(_) => StatusCode::CONFLICT,
            ChannelLabelsError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ChannelLabelsError::Unauthorized => StatusCode::FORBIDDEN,
            ChannelLabelsError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match &self {
            ChannelLabelsError::Internal(_) => {
                tracing::error!(error=?self, "channel labels internal server error");
                "internal server error".to_string()
            }
            error => error.to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
