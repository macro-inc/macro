use axum::{Json, extract::State, http::StatusCode};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use macro_user_id::{email::Email, lowercased::Lowercase};
use model_error_response::ErrorResponse;

use crate::domain::{model::InviteUsersToTeamError, team_repo::TeamService};

use super::TeamRouterState;

/// A single invite entry with email and tier
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema, Clone)]
pub struct InviteEntry {
    /// The email of the user to invite
    pub email: String,
}

/// The request body to invite a user to a team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct InviteToTeamRequest {
    /// The invites to send, each with an email and tier
    pub invites: Vec<InviteEntry>,
}

/// Error type for the invite to team handler
#[derive(Debug, thiserror::Error)]
pub enum InviteToTeamError {
    /// Unable to invite users to team
    #[error("unable to invite users to team")]
    InviteUsersToTeamError(#[from] InviteUsersToTeamError),
    /// Invalid emails detected
    #[error("unable to parse email")]
    InvalidEmails,
    /// No valid emails provided
    #[error("no valid emails provided")]
    NoValidEmailsProvided,
}

impl axum::response::IntoResponse for InviteToTeamError {
    fn into_response(self) -> axum::response::Response {
        match self {
            InviteToTeamError::InvalidEmails => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid emails detected".into(),
                }),
            ),
            InviteToTeamError::NoValidEmailsProvided => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "no emails provided".into(),
                }),
            ),
            InviteToTeamError::InviteUsersToTeamError(e) => match e {
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
            },
        }
        .into_response()
    }
}

/// Invites a user to a team.
#[utoipa::path(
    post,
    path = "/team/invite",
    operation_id = "invite_to_team",
    request_body = InviteToTeamRequest,
    responses(
        (status = 201),
        (status = 304),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Json(req): Json<InviteToTeamRequest>,
) -> Result<StatusCode, InviteToTeamError> {
    let parsed: Vec<Result<Email<Lowercase<'_>>, _>> = req
        .invites
        .iter()
        .map(|entry| Email::parse_from_str(&entry.email).map(|email| email.lowercase()))
        .collect();

    if parsed.iter().any(|e| e.is_err()) {
        return Err(InviteToTeamError::InvalidEmails);
    }

    let invites: Vec<_> = parsed.into_iter().map(|e| e.unwrap()).collect();

    let invites = non_empty::NonEmpty::new(invites.as_slice())
        .map_err(|_| InviteToTeamError::NoValidEmailsProvided)?;

    let team_invites = state
        .service
        .invite_users_to_team(access.entity_access_receipt, invites)
        .await
        .map_err(InviteToTeamError::InviteUsersToTeamError)?;

    if team_invites.is_empty() {
        return Ok(StatusCode::NOT_MODIFIED);
    }

    Ok(StatusCode::CREATED)
}
