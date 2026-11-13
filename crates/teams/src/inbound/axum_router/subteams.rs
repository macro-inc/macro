//! Routes for the teams inside the caller's workspace, nested at
//! `/team/subteams`.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, put},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;

use crate::domain::subteam::{
    NewSubteam, Subteam, SubteamColor, SubteamDescription, SubteamError, SubteamJoinPolicy,
    SubteamName, SubteamPatch, SubteamRole, SubteamService,
};

/// Router state for the workspace teams routes.
pub struct SubteamRouterState<Service, Eas, Auth> {
    /// The workspace teams service.
    pub service: Arc<Service>,
    /// The entity access service.
    pub entity_access_service: Arc<Eas>,
    /// State for request authorization.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Service, Eas, Auth> Clone for SubteamRouterState<Service, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Service, Eas, Auth> FromRef<SubteamRouterState<Service, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &SubteamRouterState<Service, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<Service, Eas, Auth> FromRef<SubteamRouterState<Service, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &SubteamRouterState<Service, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The workspace teams routes, to nest at `/team/subteams`.
pub fn subteams_router<Service, Eas, Auth, S>(
    state: SubteamRouterState<Service, Eas, Auth>,
) -> Router<S>
where
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/",
            get(list_handler::<Service, Eas, Auth>).post(create_handler::<Service, Eas, Auth>),
        )
        .route(
            "/{subteam_id}",
            axum::routing::patch(update_handler::<Service, Eas, Auth>)
                .delete(delete_handler::<Service, Eas, Auth>),
        )
        .route(
            "/{subteam_id}/parent",
            put(nest_handler::<Service, Eas, Auth>),
        )
        .route(
            "/{subteam_id}/members/{user_id}",
            put(save_member_handler::<Service, Eas, Auth>)
                .delete(remove_member_handler::<Service, Eas, Auth>),
        )
        .with_state(state)
}

impl IntoResponse for SubteamError {
    fn into_response(self) -> Response {
        let status = match &self {
            SubteamError::NotFound => StatusCode::NOT_FOUND,
            SubteamError::NotManager | SubteamError::InviteOnly => StatusCode::FORBIDDEN,
            SubteamError::InvalidName
            | SubteamError::DescriptionTooLong
            | SubteamError::InvalidParent
            | SubteamError::NotWorkspaceMember => StatusCode::BAD_REQUEST,
            SubteamError::AccessError(_) => StatusCode::UNAUTHORIZED,
            SubteamError::StorageLayerError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = match status {
            StatusCode::INTERNAL_SERVER_ERROR => "internal server error".to_string(),
            _ => self.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// The teams in the caller's workspace.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ListSubteamsResponse {
    /// Every team in the workspace with its members, ordered by name.
    pub subteams: Vec<Subteam>,
}

/// A team to create.
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSubteamRequest {
    /// The team's name, 1 to 40 characters.
    pub name: String,
    /// What the team does, at most 200 characters.
    #[serde(default)]
    pub description: String,
    /// The color of the team's mark.
    pub color: SubteamColor,
    /// Who may join without being added.
    pub join_policy: SubteamJoinPolicy,
    /// The top-level team to nest the new team in. The caller must manage it.
    pub parent_id: Option<uuid::Uuid>,
    /// Workspace members to add besides the caller, who becomes its manager.
    #[serde(default)]
    #[schema(value_type = Vec<String>)]
    pub member_ids: Vec<MacroUserIdStr<'static>>,
}

/// Changes to a team's settings. Omitted fields stay as they are.
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSubteamRequest {
    /// The new name, 1 to 40 characters.
    pub name: Option<String>,
    /// The new description, at most 200 characters.
    pub description: Option<String>,
    /// The new color.
    pub color: Option<SubteamColor>,
    /// The new join policy.
    pub join_policy: Option<SubteamJoinPolicy>,
}

/// Where to move a team.
#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NestSubteamRequest {
    /// The top-level team to move it under, or null for the top level.
    pub parent_id: Option<uuid::Uuid>,
}

/// The role to give a team member.
#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct SaveSubteamMemberRequest {
    /// The member's role in the team.
    pub role: SubteamRole,
}

/// Path parameters naming a team.
#[derive(serde::Deserialize)]
pub struct SubteamPath {
    subteam_id: uuid::Uuid,
}

/// Path parameters naming a team member.
#[derive(serde::Deserialize)]
pub struct SubteamMemberPath {
    subteam_id: uuid::Uuid,
    user_id: MacroUserIdStr<'static>,
}

/// Lists the teams in the caller's workspace with their members.
#[utoipa::path(
    get,
    path = "/team/subteams",
    operation_id = "list_subteams",
    responses(
        (status = 200, body = ListSubteamsResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn list_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
) -> Result<Json<ListSubteamsResponse>, SubteamError> {
    let subteams = state
        .service
        .list_subteams(access.entity_access_receipt)
        .await?;

    Ok(Json(ListSubteamsResponse { subteams }))
}

/// Creates a team in the caller's workspace. The caller becomes its manager.
#[utoipa::path(
    post,
    path = "/team/subteams",
    operation_id = "create_subteam",
    request_body = CreateSubteamRequest,
    responses(
        (status = 201, body = Subteam),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn create_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Json(request): Json<CreateSubteamRequest>,
) -> Result<(StatusCode, Json<Subteam>), SubteamError> {
    let subteam = NewSubteam {
        parent_id: request.parent_id,
        name: SubteamName::parse(&request.name)?,
        description: SubteamDescription::parse(&request.description)?,
        color: request.color,
        join_policy: request.join_policy,
    };

    let created = state
        .service
        .create_subteam(access.entity_access_receipt, subteam, request.member_ids)
        .await?;

    Ok((StatusCode::CREATED, Json(created)))
}

/// Changes a team's name, description, color, or join policy. Requires
/// managing the team or being a workspace admin.
#[utoipa::path(
    patch,
    path = "/team/subteams/{subteam_id}",
    operation_id = "update_subteam",
    params(("subteam_id" = uuid::Uuid, Path, description = "The team's id")),
    request_body = UpdateSubteamRequest,
    responses(
        (status = 200, body = Subteam),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(subteam_id = %subteam_id), err)]
pub async fn update_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Path(SubteamPath { subteam_id }): Path<SubteamPath>,
    Json(request): Json<UpdateSubteamRequest>,
) -> Result<Json<Subteam>, SubteamError> {
    let patch = SubteamPatch {
        name: request
            .name
            .as_deref()
            .map(SubteamName::parse)
            .transpose()?,
        description: request
            .description
            .as_deref()
            .map(SubteamDescription::parse)
            .transpose()?,
        color: request.color,
        join_policy: request.join_policy,
    };

    let updated = state
        .service
        .update_subteam(access.entity_access_receipt, subteam_id, patch)
        .await?;

    Ok(Json(updated))
}

/// Moves a team under another top-level team, or to the top level. Teams nest
/// one level. Requires managing the team and the new parent.
#[utoipa::path(
    put,
    path = "/team/subteams/{subteam_id}/parent",
    operation_id = "nest_subteam",
    params(("subteam_id" = uuid::Uuid, Path, description = "The team's id")),
    request_body = NestSubteamRequest,
    responses(
        (status = 200, body = Subteam),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(subteam_id = %subteam_id), err)]
pub async fn nest_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Path(SubteamPath { subteam_id }): Path<SubteamPath>,
    Json(request): Json<NestSubteamRequest>,
) -> Result<Json<Subteam>, SubteamError> {
    let nested = state
        .service
        .nest_subteam(access.entity_access_receipt, subteam_id, request.parent_id)
        .await?;

    Ok(Json(nested))
}

/// Deletes a team. Its nested teams move to the top level. Requires managing
/// the team or being a workspace admin.
#[utoipa::path(
    delete,
    path = "/team/subteams/{subteam_id}",
    operation_id = "delete_subteam",
    params(("subteam_id" = uuid::Uuid, Path, description = "The team's id")),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(subteam_id = %subteam_id), err)]
pub async fn delete_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Path(SubteamPath { subteam_id }): Path<SubteamPath>,
) -> Result<StatusCode, SubteamError> {
    state
        .service
        .delete_subteam(access.entity_access_receipt, subteam_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Adds a workspace member to a team or changes their role. Managers may add
/// anyone in the workspace; anyone may join an open team as a member.
#[utoipa::path(
    put,
    path = "/team/subteams/{subteam_id}/members/{user_id}",
    operation_id = "save_subteam_member",
    params(
        ("subteam_id" = uuid::Uuid, Path, description = "The team's id"),
        ("user_id" = String, Path, description = "The member's user id"),
    ),
    request_body = SaveSubteamMemberRequest,
    responses(
        (status = 200, body = Subteam),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(subteam_id = %subteam_id), err)]
pub async fn save_member_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Path(SubteamMemberPath {
        subteam_id,
        user_id,
    }): Path<SubteamMemberPath>,
    Json(request): Json<SaveSubteamMemberRequest>,
) -> Result<Json<Subteam>, SubteamError> {
    let subteam = state
        .service
        .save_subteam_member(
            access.entity_access_receipt,
            subteam_id,
            user_id,
            request.role,
        )
        .await?;

    Ok(Json(subteam))
}

/// Removes someone from a team. Anyone may leave; managers and workspace
/// admins may remove anyone.
#[utoipa::path(
    delete,
    path = "/team/subteams/{subteam_id}/members/{user_id}",
    operation_id = "remove_subteam_member",
    params(
        ("subteam_id" = uuid::Uuid, Path, description = "The team's id"),
        ("user_id" = String, Path, description = "The member's user id"),
    ),
    responses(
        (status = 200, body = Subteam),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, fields(subteam_id = %subteam_id), err)]
pub async fn remove_member_handler<
    Service: SubteamService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<SubteamRouterState<Service, Eas, Auth>>,
    Path(SubteamMemberPath {
        subteam_id,
        user_id,
    }): Path<SubteamMemberPath>,
) -> Result<Json<Subteam>, SubteamError> {
    let subteam = state
        .service
        .remove_subteam_member(access.entity_access_receipt, subteam_id, user_id)
        .await?;

    Ok(Json(subteam))
}
