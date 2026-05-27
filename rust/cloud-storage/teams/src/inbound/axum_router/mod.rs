//! Axum router for team endpoints.

/// Create a new team.
pub mod create_team;
/// Delete a team.
pub mod delete_team;
/// Delete a team invite.
pub mod delete_team_invite;
/// Get a team by ID.
pub mod get_team;
/// Get all invites for a team.
pub mod get_team_invites;
/// Get all invites for a user.
pub mod get_user_invites;
/// Get all teams for a user.
pub mod get_user_teams;
/// Invite users to a team.
pub mod invite_to_team;
/// Join a team via invite.
pub mod join_team;
/// Update a team.
pub mod patch_team;
/// Enable / disable CRM for a team.
pub mod patch_team_crm_settings;
/// Reject a team invitation.
pub mod reject_invitation;
/// Remove a user from a team.
pub mod remove_user_from_team;

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::FromRef,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{
        CreateTeamError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError,
        RemoveTeamInviteError, RemoveUserFromTeamError, TeamError,
    },
    team_repo::TeamService,
};

/// Router state containing the team service.
pub struct TeamRouterState<T, Eas> {
    /// The team service implementation.
    pub service: Arc<T>,
    /// The entity access service.
    pub entity_access_service: Arc<Eas>,
}

impl<T, Eas> FromRef<TeamRouterState<T, Eas>> for Arc<Eas> {
    fn from_ref(state: &TeamRouterState<T, Eas>) -> Self {
        state.entity_access_service.clone()
    }
}

// Manual Clone impl so T, Eas doesn't need to be Clone (it's behind Arc).
impl<T, Eas> Clone for TeamRouterState<T, Eas> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

/// Build the teams router with all endpoints.
pub fn teams_router<T, Eas, S>(state: TeamRouterState<T, Eas>) -> Router<S>
where
    T: TeamService,
    Eas: EntityAccessService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_team::handler::<T, Eas>))
        .route("/join/{team_invite_id}", get(join_team::handler::<T, Eas>))
        .route("/user", get(get_user_teams::handler::<T, Eas>))
        .route("/user/invites", get(get_user_invites::handler::<T, Eas>))
        .route("/", get(get_team::handler::<T, Eas>))
        .route("/", patch(patch_team::handler::<T, Eas>))
        .route("/", delete(delete_team::handler::<T, Eas>))
        .route("/crm", patch(patch_team_crm_settings::handler::<T, Eas>))
        .route("/invites", get(get_team_invites::handler::<T, Eas>))
        .route("/invite", post(invite_to_team::handler::<T, Eas>))
        .route(
            "/join/{team_invite_id}",
            delete(reject_invitation::handler::<T, Eas>),
        )
        .route(
            "/remove/{remove_user_id}",
            delete(remove_user_from_team::handler::<T, Eas>),
        )
        .route(
            "/invite/{team_invite_id}",
            delete(delete_team_invite::handler::<T, Eas>),
        )
        .with_state(state)
}

// --- Error IntoResponse implementations ---

impl IntoResponse for TeamError {
    fn into_response(self) -> Response {
        match self {
            TeamError::TeamDoesNotExist => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "team does not exist".into(),
                }),
            ),
            TeamError::TeamMemberNotFound(_) => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: self.to_string().into(),
                }),
            ),

            TeamError::TeamInviteDoesNotExist => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "team invite does not exist".into(),
                }),
            ),
            TeamError::BadRequest(_) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: self.to_string().into(),
                }),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for CreateTeamError {
    fn into_response(self) -> Response {
        match self {
            CreateTeamError::InvalidTeamName(_) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid team name".into(),
                }),
            ),
            CreateTeamError::StorageLayerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to create team".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for DeleteTeamError {
    fn into_response(self) -> Response {
        match self {
            DeleteTeamError::TeamError(_) | DeleteTeamError::StorageLayerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to delete team".into(),
                }),
            ),
            DeleteTeamError::RemoveRolesFromUserError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "invalid roles provided".into(),
                }),
            ),
            DeleteTeamError::CustomerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to delete team subscription".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for InviteUsersToTeamError {
    fn into_response(self) -> Response {
        match self {
            InviteUsersToTeamError::TooManyEmails => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "too many emails".into(),
                }),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to invite users to team".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for JoinTeamError {
    fn into_response(self) -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to join team".into(),
            }),
        )
            .into_response()
    }
}

impl IntoResponse for RemoveTeamInviteError {
    fn into_response(self) -> Response {
        match self {
            RemoveTeamInviteError::TeamInviteDoesNotExist => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "team invite does not exist".into(),
                }),
            ),
            RemoveTeamInviteError::UserNotInTeam => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "user not in team".into(),
                }),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            ),
        }
        .into_response()
    }
}

impl IntoResponse for RemoveUserFromTeamError {
    fn into_response(self) -> Response {
        match self {
            RemoveUserFromTeamError::TeamDoesNotExist => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "team does not exist".into(),
                }),
            ),
            RemoveUserFromTeamError::CannotRemoveOwner => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "cannot remove owner".into(),
                }),
            ),
            RemoveUserFromTeamError::UserNotInTeam => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not in team".into(),
                }),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to remove user from team".into(),
                }),
            ),
        }
        .into_response()
    }
}
