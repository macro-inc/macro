use crate::api::context::AppState;
use anyhow::Result;
use axum::{
    Json,
    extract::{self, Extension, State},
    http::StatusCode,
};
use comms_db_client::channels::{
    create_channel::{CreateChannelOptions, create_channel},
    get_dm,
};
use model::{
    comms::{ChannelType, GetOrCreateAction},
    user::UserContext,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetOrCreateDmResponse {
    pub channel_id: String,
    pub action: GetOrCreateAction,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetOrCreateDmRequest {
    pub recipient_id: String,
}

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "get_or_create_dm",
    description = "given a user and a recipient, either finds or creates a direct message channel",
    path = "/channels/get_or_create_dm",
    responses(
        (status = 200, body=GetOrCreateDmResponse),
        (status = 400, body=String),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
#[tracing::instrument(
    skip(ctx, user_context),
    fields(user_id=?user_context.user_id, recipient_id=?req.recipient_id)
)]
pub async fn handler(
    State(ctx): State<AppState>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<GetOrCreateDmRequest>,
) -> Result<(StatusCode, Json<GetOrCreateDmResponse>), (StatusCode, String)> {
    // You cannot make a DM with yourself
    let recipient_id = req.recipient_id.to_lowercase();
    let user_id = user_context.user_id.to_lowercase();

    if recipient_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "recipient_id must be a non-empty string".to_string(),
        ));
    }

    if !recipient_id.starts_with("macro|") {
        return Err((
            StatusCode::BAD_REQUEST,
            "recipient_id must be 'macro|<email>'".to_string(),
        ));
    }

    if recipient_id == user_id {
        return Err((
            StatusCode::BAD_REQUEST,
            "recipient_id cannot be the same as the user_id".to_string(),
        ));
    }

    let maybe_dm = get_dm::maybe_get_dm(&ctx.db, &user_id, &recipient_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get direct message channel");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get direct message channel".to_string(),
            )
        })?;

    let (dm_id, action) = match maybe_dm {
        Some(private_id) => (private_id, GetOrCreateAction::Get),
        None => {
            let id = create_channel(
                &ctx.db,
                CreateChannelOptions {
                    name: None,
                    owner_id: user_id.clone(),
                    org_id: None,
                    channel_type: ChannelType::DirectMessage,
                    participants: vec![user_id.clone(), recipient_id.clone()],
                },
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to create channel");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to create channel".to_string(),
                )
            })?;
            // Contacts: create connections
            let sqs_client = &ctx.sqs_client;
            sqs_client
                .enqueue_contacts_create_channel(
                    vec![user_id.clone(), recipient_id.clone()],
                    &id.to_string(),
                )
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "unable to create 'add participant' SQS message");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "unable to create 'add participant' SQS message".to_string(),
                    )
                })?;
            (id, GetOrCreateAction::Create)
        }
    };

    Ok((
        StatusCode::OK,
        Json(GetOrCreateDmResponse {
            channel_id: dm_id.to_string(),
            action,
        }),
    ))
}
