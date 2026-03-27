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
/// Team access control middleware.
pub mod middleware;
/// Update a team.
pub mod patch_team;
/// Patch a team users tier.
pub mod patch_team_user_tier;
/// Reinvite a user to a team.
pub mod reinvite_to_team;
/// Reject a team invitation.
pub mod reject_invitation;
/// Remove a user from a team.
pub mod remove_user_from_team;

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{
        CreateTeamError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError, ReinviteError,
        RemoveTeamInviteError, RemoveUserFromTeamError, TeamError,
    },
    team_repo::TeamService,
};

/// Shared path param for team endpoints.
#[derive(serde::Deserialize)]
pub struct TeamPathParam {
    /// The team id
    pub team_id: uuid::Uuid,
}

/// Router state containing the team service.
pub struct TeamRouterState<T> {
    /// The team service implementation.
    pub service: Arc<T>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T> Clone for TeamRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the teams router with all endpoints.
pub fn teams_router<T, S>(state: TeamRouterState<T>) -> Router<S>
where
    T: TeamService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/", post(create_team::handler::<T>))
        .route("/join/{team_invite_id}", get(join_team::handler::<T>))
        .route("/user", get(get_user_teams::handler::<T>))
        .route("/user/invites", get(get_user_invites::handler::<T>))
        .route("/{team_id}", get(get_team::handler::<T>))
        .route("/{team_id}", patch(patch_team::handler::<T>))
        .route("/{team_id}/tier", patch(patch_team_user_tier::handler::<T>))
        .route("/{team_id}", delete(delete_team::handler::<T>))
        .route("/{team_id}/invites", get(get_team_invites::handler::<T>))
        .route("/{team_id}/invite", post(invite_to_team::handler::<T>))
        .route(
            "/{team_id}/reinvite/{team_invite_id}",
            post(reinvite_to_team::handler::<T>),
        )
        .route(
            "/join/{team_invite_id}",
            delete(reject_invitation::handler::<T>),
        )
        .route(
            "/{team_id}/remove/{remove_user_id}",
            delete(remove_user_from_team::handler::<T>),
        )
        .route(
            "/{team_id}/invite/{team_invite_id}",
            delete(delete_team_invite::handler::<T>),
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

impl IntoResponse for ReinviteError {
    fn into_response(self) -> Response {
        match self {
            ReinviteError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorResponse {
                    message: "team invite has not been sent in the last 5 minutes".into(),
                }),
            ),
            ReinviteError::InviteNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "team invite does not exist".into(),
                }),
            ),
            ReinviteError::StorageLayerError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal server error".into(),
                }),
            ),
        }
        .into_response()
    }
}
