use crate::api::channels::create_channel::to_lowercase;
use crate::api::context::AppState;
use std::iter;

use anyhow::Result;
use axum::{
    Json,
    extract::{self, Extension, State},
    http::StatusCode,
};
use comms_db_client::channels::{
    create_channel::{CreateChannelOptions, create_channel},
    get_private,
};
use model::{
    comms::{ChannelType, GetOrCreateAction},
    user::UserContext,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetOrCreatePrivateResponse {
    pub channel_id: String,
    pub action: GetOrCreateAction,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GetOrCreatePrivateRequest {
    pub recipients: Vec<String>,
}

#[utoipa::path(
    post,
    tag = "channels",
    operation_id = "get_or_create_private",
    description = "given a list of partiicpants, either fetch an existing private channel with the permtation or create a new one",
    path = "/channels/get_or_create_private",
    responses(
        (status = 200, body=GetOrCreatePrivateResponse),
        (status = 400, body=String),
        (status = 401, body=String),
        (status = 404, body=String),
        (status = 500, body=String),
    )
)]
#[tracing::instrument(
    skip(ctx, user_context),
    fields(user_id=?user_context.user_id, recipients=?req.recipients)
)]
pub async fn handler(
    State(ctx): State<AppState>,
    user_context: Extension<UserContext>,
    extract::Json(mut req): extract::Json<GetOrCreatePrivateRequest>,
) -> Result<(StatusCode, Json<GetOrCreatePrivateResponse>), (StatusCode, String)> {
    // Filter out all invalidly formatted recipients
    req.recipients = req
        .recipients
        .into_iter()
        .filter_map(|r| r.starts_with("macro|").then_some(r.to_lowercase()))
        .collect();

    if req.recipients.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "recipients must be a non-empty list of 'macro|<email>'".to_string(),
        ));
    }

    let user_id = user_context.user_id.to_lowercase();
    let maybe_private = get_private::maybe_get_private_channel(
        &ctx.db,
        // When requesting the private channel,
        // we also need to include the id of the user making the request
        &req.recipients
            .clone()
            .into_iter()
            .chain(iter::once(user_id.clone()))
            .collect::<Vec<_>>(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get private channel");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get private message channel".to_string(),
        )
    })?;

    let (private_id, action) = match maybe_private {
        Some(private_id) => (private_id, GetOrCreateAction::Get),
        None => {
            let recipients = to_lowercase(&req.recipients);
            let id = create_channel(
                &ctx.db,
                CreateChannelOptions {
                    name: None,
                    owner_id: user_id.clone(),
                    org_id: None,
                    channel_type: ChannelType::Private,
                    participants: recipients.clone(),
                },
            )
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to create private channel");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to create private channel".to_string(),
                )
            })?;
            let sqs_client = &ctx.sqs_client;
            let mut recipients = recipients.clone();
            recipients.push(user_id.clone());
            sqs_client
                .enqueue_contacts_create_channel(recipients, &id.to_string())
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
        Json(GetOrCreatePrivateResponse {
            channel_id: private_id.to_string(),
            action,
        }),
    ))
}
