use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use macro_user_id::{email::Email, lowercased::Lowercase};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::InviteUsersToTeamError, team_repo::TeamService};

use super::{TeamPathParam, TeamRouterState, middleware::TeamAccessRoleExtractor};

/// The request body to invite a user to a team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct InviteToTeamRequest {
    /// The emails of the users you want to invite to the team
    pub emails: Vec<String>,
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
    path = "/team/{team_id}/invite",
    operation_id = "invite_to_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team to invite to")
    ),
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
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::OwnerRole, T>,
    State(state): State<TeamRouterState<T>>,
    user_context: MacroUserExtractor,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
    Json(req): Json<InviteToTeamRequest>,
) -> Result<StatusCode, InviteToTeamError> {
    let emails: Vec<Result<Email<Lowercase<'_>>, _>> = req
        .emails
        .iter()
        .map(|email| Email::parse_from_str(email).map(|email| email.lowercase()))
        .collect();

    if emails.iter().any(|e| e.is_err()) {
        return Err(InviteToTeamError::InvalidEmails);
    }

    let emails = emails.into_iter().map(|e| e.unwrap()).collect::<Vec<_>>();

    let emails = non_empty::NonEmpty::new(emails.as_slice())
        .map_err(|_| InviteToTeamError::NoValidEmailsProvided)?;

    let team_invites = state
        .service
        .invite_users_to_team(&team_id, &user_context.macro_user_id, emails)
        .await
        .map_err(InviteToTeamError::InviteUsersToTeamError)?;

    if team_invites.is_empty() {
        return Ok(StatusCode::NOT_MODIFIED);
    }

    Ok(StatusCode::CREATED)
}
