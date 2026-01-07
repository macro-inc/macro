use axum::extract::{Json, State};
use comms_db_client::{
    channels::get_channels::get_org_channels,
    participants::remove_participant::{RemoveParticipantOptions, remove_participant},
};

use model::comms::RemoveUserFromOrgChannelsRequest;
use reqwest::StatusCode;

use crate::api::context::AppState;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<AppState>,
    req: Json<RemoveUserFromOrgChannelsRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::trace!("removing user from organization channels");

    let org_channels = get_org_channels(&ctx.db, &req.org_id).await.map_err(|e| {
        tracing::error!(error=?e, "unable to get org channels");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to get org channels".to_string(),
        )
    })?;

    for channel in org_channels.iter() {
        remove_participant(
            &ctx.db,
            RemoveParticipantOptions {
                channel_id: &channel.id,
                user_id: &req.user_id,
            },
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to remove user from org channel");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to remove user from org channel".to_string(),
            )
        })?;
    }

    Ok(StatusCode::OK)
}
