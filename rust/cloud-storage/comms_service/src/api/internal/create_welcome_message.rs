use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use comms_db_client::{
    activity::upsert_activity::upsert_activity,
    channels::{
        create_channel::{CreateChannelOptions, create_channel},
        get_dm, updated_at,
    },
    messages::create_message,
    model::ActivityType,
};
use tracing::Instrument;

use crate::{api::context::AppState, service::sender::notify};
use model::{
    comms::{ChannelType, CreateWelcomeMessageRequest, GetOrCreateAction},
    response::EmptyResponse,
};

static WELCOME_MESSAGE: &str = "Welcome to Macro. If you have any questions, please reach out!";
static SLEEP_TIME_SECONDS: u64 = 60;

#[tracing::instrument(skip(app_state))]
pub async fn handler(
    State(app_state): State<AppState>,
    req: extract::Json<CreateWelcomeMessageRequest>,
) -> Result<Response, Response> {
    tracing::trace!("checking channels for user");

    if req.welcome_user_id.is_empty() || req.to_user_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty user ids").into_response());
    }

    tokio::spawn(
        {
            let ctx = app_state.clone();
            let welcome_user_id = req.welcome_user_id.clone();
            let to_user_id = req.to_user_id.clone();
            async move {
                if let Err(e) = create_welcome_message(&ctx, &welcome_user_id, &to_user_id).await {
                    tracing::error!(error=?e, "unable to create welcome message");
                }
            }
        }
        .in_current_span(),
    );

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}

#[tracing::instrument(skip(ctx))]
async fn create_welcome_message(
    ctx: &AppState,
    welcome_user_id: &str,
    to_user_id: &str,
) -> anyhow::Result<()> {
    let content = WELCOME_MESSAGE.to_string();
    let sleep_time = SLEEP_TIME_SECONDS;
    let participants: Vec<String> = vec![welcome_user_id.to_string(), to_user_id.to_string()];

    tracing::trace!("sleeping welcome message");
    tokio::time::sleep(std::time::Duration::from_secs(sleep_time)).await;

    let maybe_dm = get_dm::maybe_get_dm(&ctx.db, welcome_user_id, to_user_id).await?;

    let (channel_id, action) = match maybe_dm {
        Some(private_id) => (private_id, GetOrCreateAction::Get),
        None => {
            let id = create_channel(
                &ctx.db,
                CreateChannelOptions {
                    name: None,
                    owner_id: welcome_user_id.to_string(),
                    org_id: None,
                    channel_type: ChannelType::DirectMessage,
                    participants: participants.clone(),
                },
            )
            .await?;

            (id, GetOrCreateAction::Create)
        }
    };

    if action == GetOrCreateAction::Get {
        tracing::debug!("dm already exists");
        return Ok(());
    }

    tracing::trace!("sending welcome message to dm");
    let mut connection = ctx.db.acquire().await?;

    let message = create_message::create_message(
        &mut *connection,
        create_message::CreateMessageOptions {
            channel_id,
            sender_id: welcome_user_id.to_string(),
            content: content.to_string(),
            thread_id: None,
        },
    )
    .await?;

    tracing::trace!("created welcome message to dm");

    updated_at::updated_at(&mut *connection, &message.channel_id)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to update channel updated_at");
        })
        .ok();

    notify::notify_message(ctx, message.clone(), &participants).await?;

    upsert_activity(
        &ctx.db,
        welcome_user_id,
        &channel_id,
        &ActivityType::Interact,
    )
    .await
    .inspect_err(|err| {
        tracing::error!(error=?err, "unable to upsert activity for message");
    })
    .ok();

    Ok(())
}
