use axum::extract::{Json, State};
use comms_db_client::{
    channels::get_channels::get_org_channels,
    participants::add_participant::{AddParticipantOptions, add_participant},
};
use model::comms::{AddUserToOrgChannelsRequest, ParticipantRole};
use reqwest::StatusCode;

use crate::api::context::AppState;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    req: Json<AddUserToOrgChannelsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::trace!("adding user to org channels");

    let org_channels = get_org_channels(&ctx.db, &req.org_id).await.map_err(|e| {
        tracing::error!(error=?e, "unable to get org channels");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to get org channels".to_string(),
        )
    })?;

    for channel in org_channels.iter() {
        add_participant(
            &ctx.db,
            AddParticipantOptions {
                channel_id: &channel.id,
                user_id: &req.user_id,
                participant_role: Some(ParticipantRole::Member),
            },
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to add user to org channel");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to add user to org channel".to_string(),
            )
        })?;
    }

    Ok(StatusCode::OK)
}
