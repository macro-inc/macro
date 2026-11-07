use axum::{Json, extract::State, http::StatusCode};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationExtractor, MacroAuthorizationService,
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
    /// The team the caller means to invite to. Invites always go to the
    /// caller's current team; when this names another team, nothing is sent
    /// and the request answers 409.
    #[serde(default)]
    pub team_id: Option<uuid::Uuid>,
    /// Invite these addresses as agents: an address with no account signs up
    /// as an agent and joins the team when it first signs in.
    #[serde(default)]
    pub is_agent: bool,
    /// Runtimes the caller owns to share with each person who accepts. Others
    /// are ignored. Honored only from the caller's own session.
    #[serde(default)]
    pub harness_ids: Vec<uuid::Uuid>,
}

/// Error type for the invite to team handler
#[derive(Debug, thiserror::Error)]
pub enum InviteToTeamError {
    /// Unable to invite users to team
    #[error("unable to invite users to team: {0}")]
    InviteUsersToTeamError(#[from] InviteUsersToTeamError),
    /// Invalid emails detected
    #[error("unable to parse email")]
    InvalidEmails,
    /// No valid emails provided
    #[error("no valid emails provided")]
    NoValidEmailsProvided,
    /// The request named a team other than the caller's current team
    #[error("the requested team is not the caller's current team")]
    NotCurrentTeam,
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
            InviteToTeamError::NotCurrentTeam => return super::not_current_team_response(),
            // Domain errors share one mapping - see the IntoResponse impl
            // for InviteUsersToTeamError in this crate's axum_router module.
            InviteToTeamError::InviteUsersToTeamError(e) => return e.into_response(),
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
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse, description = "`team_id` names a team other than the caller's current team"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    authorization: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    Json(req): Json<InviteToTeamRequest>,
) -> Result<StatusCode, InviteToTeamError> {
    if !super::is_expected_team(&access.entity_access_receipt, req.team_id) {
        return Err(InviteToTeamError::NotCurrentTeam);
    }

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
        .invite_users_to_team(access.entity_access_receipt, invites, req.is_agent)
        .await
        .map_err(InviteToTeamError::InviteUsersToTeamError)?;

    if team_invites.is_empty() {
        return Ok(StatusCode::NOT_MODIFIED);
    }

    if let MacroAuthorization::User(inviter) = &authorization.authorization
        && inviter.is_human_session()
        && !req.harness_ids.is_empty()
    {
        let invite_ids: Vec<_> = team_invites
            .iter()
            .map(|invite| invite.team_invite_id)
            .collect();
        state
            .service
            .offer_harnesses_with_invites(&invite_ids, &inviter.macro_user_id, &req.harness_ids)
            .await
            .map_err(InviteToTeamError::InviteUsersToTeamError)?;
    }

    Ok(StatusCode::CREATED)
}
