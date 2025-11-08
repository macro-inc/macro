use crate::api::context::AppState;
use anyhow::Result;
use axum::{
    Json,
    extract::{self, Extension, State},
    http::StatusCode,
};
use comms_db_client::channels::create_channel::{CreateChannelOptions, create_channel};
use model::comms::ChannelType;
use model::user::UserContext;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateChannelRequest {
    /// Optionally a name for the channel
    pub name: Option<String>,
    /// The type of channel
    pub channel_type: ChannelType,
    /// list of participants not including the owner
    pub participants: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateChannelResponse {
    pub id: String,
}

// TODO: move to a utility file somewhere?
pub fn to_lowercase(strings: &[String]) -> Vec<String> {
    strings.iter().map(|s| s.to_lowercase()).collect()
}

#[utoipa::path(
        post,
        tag = "channels",
        path = "/channels",
        operation_id = "create_channel",
        responses(
            (status = 201, body=CreateChannelResponse),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn create_channel_handler(
    State(ctx): State<AppState>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<CreateChannelResponse>), (StatusCode, String)> {
    // We only need to define the org_id for organization channels
    let org_id_for_channel = match req.channel_type {
        ChannelType::Organization => user_context.organization_id.map(|org_id| org_id as i64),
        _ => None,
    };

    let participants = to_lowercase(&req.participants);
    let participants = participants
        .into_iter()
        .filter(|p| p.starts_with("macro|"))
        .collect::<Vec<String>>();

    if participants.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "participants must be a non-empty list of 'macro|<email>'".to_string(),
        ));
    }

    // Make a copy of the participants to be used after making the channel
    let participants_copy: Option<Vec<String>> = if req.channel_type == ChannelType::Private {
        Some(participants.clone())
    } else {
        None
    };

    let id = create_channel(
        &ctx.db,
        CreateChannelOptions {
            name: req.name.clone(),
            owner_id: user_context.user_id.clone(),
            org_id: org_id_for_channel,
            channel_type: req.channel_type,
            participants: participants.clone(),
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

    // There should always be participants, but better safe than sorry
    if !participants.is_empty() && req.channel_type == ChannelType::Private {
        // Contacts: send message create channel SQS message to Contacts Service
        let sqs_client = &ctx.sqs_client;
        sqs_client
            .enqueue_contacts_create_channel(participants_copy.unwrap(), &id.to_string())
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to create 'add participant' SQS message");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "unable to create 'add participant' SQS message".to_string(),
                )
            })?;
    }

    Ok((
        StatusCode::OK,
        Json(CreateChannelResponse { id: id.to_string() }),
    ))
}
