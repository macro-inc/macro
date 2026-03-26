use std::collections::HashSet;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;

use crate::api::{
    context::ApiContext,
    middleware::team_access::{AdminRole, TeamAccessRoleExtractor},
};
use model_notifications::InviteToTeamMetadata;

use model::{
    response::{EmptyResponse, ErrorResponse},
    tracking::IPContext,
    user::axum_extractor::MacroUserExtractor,
};

#[derive(serde::Deserialize)]
pub struct Param {
    pub team_id: uuid::Uuid,
    pub team_invite_id: uuid::Uuid,
}

/// Regenerates a team invite notifying the user again.
#[utoipa::path(
        post,
        path = "/team/{team_id}/reinvite/{team_invite_id}",
        operation_id = "reinvite_to_team",
        params(
            ("team_id" = String, Path, description = "The ID of the team to invite to"),
            ("team_invite_id" = String, Path, description = "The ID of the team invite to reinvite")
        ),
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context.client_ip, user_id=%user_context.macro_user_id, fusion_user_id=%user_context.user_context.fusion_user_id))]
pub async fn handler(
    access: TeamAccessRoleExtractor<AdminRole>,
    State(ctx): State<ApiContext>,
    ip_context: Extension<IPContext>,
    user_context: MacroUserExtractor,
    Path(Param {
        team_id,
        team_invite_id,
    }): Path<Param>,
) -> Result<Response, Response> {
    tracing::info!("reinvite_to_team");

    // check to see if we should re-invite yet (wait 5 mins for last_invite)
    // send new invite to team notification

    let team_invite = macro_db_client::team::get::get_team_invite_by_id(&ctx.db, &team_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get team invite");

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get team invite".into(),
                }),
            )
                .into_response()
        })?;

    if team_invite
        .last_sent_at
        .naive_utc()
        .ge(&(chrono::Utc::now().naive_utc() - chrono::Duration::minutes(5)))
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                message: "team invite was already sent within the last 5 minutes".into(),
            }),
        )
            .into_response());
    }

    macro_db_client::team::patch::update_team_invite_last_sent_at(&ctx.db, &team_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to update team invite last sent at");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update team invite last sent at".into(),
                }),
            )
                .into_response()
        })?;

    tokio::spawn({
        let db = ctx.db.clone();
        let notification_ingress_service = ctx.notification_ingress_service.clone();
        let normalized_email = team_invite.email;
        let invited_by = user_context.macro_user_id;
        let team_invite_id = team_invite.id;
        async move {
            let _ = notify_team_invite(
                &db,
                &*notification_ingress_service,
                &team_id,
                &team_invite_id,
                invited_by,
                &normalized_email,
            )
            .await
            .inspect_err(|e| tracing::error!(error=?e, "unable to send notification"));
        }
    });

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

async fn notify_team_invite(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification_ingress_service: &impl NotificationIngress,
    team_id: &uuid::Uuid,
    team_invite_id: &uuid::Uuid,
    invited_by: MacroUserIdStr<'static>,
    normalized_email: &str,
) -> anyhow::Result<()> {
    let team_name = macro_db_client::team::get::get_team_name(db, team_id).await?;

    let notification = InviteToTeamMetadata {
        invited_by: invited_by.clone(),
        team_name: team_name.clone(),
        team_id: team_id.to_string(),
        role: None,
    };

    let recipient = MacroUserIdStr::try_from_email(normalized_email)
        .map_err(|e| anyhow::anyhow!("failed to parse email as macro user id: {}", e))?;

    let entity_id = team_invite_id.to_string();
    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Team.with_entity_str(&entity_id),
        notification,
        sender_id: Some(invited_by),
        recipient_ids: HashSet::from([recipient]),
    }
    .into_request()
    .with_conn_gateway();

    notification_ingress_service
        .send_notification(request)
        .await
        .map_err(|e| anyhow::anyhow!("failed to send notification: {}", e))?;

    Ok(())
}
