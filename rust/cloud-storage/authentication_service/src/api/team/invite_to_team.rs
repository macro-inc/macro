use axum::{
    Extension, Json,
    extract::{self, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::{cowlike::CowLike, email::Email, lowercased::Lowercase, user_id::MacroUserId};
use teams::domain::{
    model::{InviteUsersToTeamError, TeamInvite},
    team_repo::TeamService,
};

use crate::api::{
    context::ApiContext,
    middleware::{
        has_payment_source::StripeCustomerExtractor,
        team_access::{OwnerRole, TeamAccessRoleExtractor},
    },
    team::TeamPathParam,
};

use model::{response::ErrorResponse, tracking::IPContext, user::UserContext};

use model_notifications::{
    InviteToTeamMetadata, NotificationEntity, NotificationEvent, NotificationQueueMessage,
};

/// The request body to invite a user to a team
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct InviteToTeamRequest {
    /// The emails of the users you want to invite to the team
    pub emails: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum InviteToTeamError {
    #[error("unable to invite users to team")]
    InviteUsersToTeamError(#[from] InviteUsersToTeamError),
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("unable to parse email")]
    InvalidEmails,
    #[error("no valid emails provided")]
    NoValidEmailsProvided,
}

impl IntoResponse for InviteToTeamError {
    fn into_response(self) -> Response {
        match self {
            InviteToTeamError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
            InviteToTeamError::InvalidEmails => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid emails detected",
                }),
            ),
            InviteToTeamError::NoValidEmailsProvided => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "no emails provided",
                }),
            ),
            InviteToTeamError::InviteUsersToTeamError(e) => match e {
                InviteUsersToTeamError::TooManyEmails => (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "too many emails",
                    }),
                ),
                _ => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to invite users to team",
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
            (status = 201), // created
            (status = 304), // not modified
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context, req), fields(client_ip=%ip_context.client_ip, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<OwnerRole>,
    stripe_customer: StripeCustomerExtractor,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: Extension<UserContext>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
    extract::Json(req): extract::Json<InviteToTeamRequest>,
) -> Result<StatusCode, InviteToTeamError> {
    tracing::info!("invite_to_team");

    let user_id: MacroUserId<Lowercase> = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| InviteToTeamError::InvalidMacroUserId)?
        .lowercase();

    let emails: Vec<Result<Email<Lowercase>, _>> = req
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

    let team_invites = ctx
        .teams_service
        .invite_users_to_team(&team_id, &user_id, emails)
        .await
        .map_err(InviteToTeamError::InviteUsersToTeamError)?;

    if team_invites.is_empty() {
        return Ok(StatusCode::NOT_MODIFIED);
    }

    let team_invites: Vec<TeamInvite<'_>> = team_invites
        .into_iter()
        .map(|e| TeamInvite {
            team_id: e.team_id,
            team_invite_id: e.team_invite_id,
            email: e.email.into_owned(),
        })
        .collect();

    // Send the invites
    tokio::spawn({
        let db = ctx.db.clone();
        let macro_notify_client = ctx.macro_notify_client.clone();
        let team_invites = team_invites.clone();
        let invited_by = user_context.user_id.clone();
        async move {
            let _ = notify_team_invite(
                &db,
                &macro_notify_client,
                &team_id,
                team_invites,
                &invited_by,
            )
            .await
            .inspect_err(|e| tracing::error!(error=?e, "unable to send notification"));
        }
    });

    Ok(StatusCode::CREATED)
}

pub(in crate::api::team) async fn notify_team_invite(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_notify_client: &macro_notify::MacroNotify,
    team_id: &uuid::Uuid,
    team_invites: Vec<TeamInvite<'_>>,
    invited_by: &str,
) -> anyhow::Result<()> {
    let team_name = macro_db_client::team::get::get_team_name(db, team_id).await?;

    let notification_metadata = InviteToTeamMetadata {
        invited_by: invited_by.to_string(),
        team_name: team_name.clone(),
        team_id: team_id.to_string(),
        role: None,
    };

    for team_invite in team_invites {
        let notification_queue_message = NotificationQueueMessage {
            notification_entity: NotificationEntity::new_team(
                team_invite.team_invite_id.to_string(),
            ),
            notification_event: NotificationEvent::InviteToTeam(notification_metadata.clone()),
            sender_id: Some(invited_by.to_string()),
            recipient_ids: Some(vec![format!("macro|{}", team_invite.email.as_ref())]),
            is_important_v0: Some(false),
        };

        macro_notify_client
            .send_notification(notification_queue_message)
            .await?;
    }

    Ok(())
}
