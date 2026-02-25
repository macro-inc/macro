use crate::{
    constants::DEFAULT_TIMEOUT_THRESHOLD,
    model::{
        connection::ConnectionContext,
        message::{Message, OutgoingMessage},
        tracking::{TrackAction, TrackingData},
    },
};
use anyhow::Result;
use frecency::domain::{
    models::{EventRecord, FrecencyAction, FrecencyEntity, FrecencyEvent},
    ports::EventIngestorService,
};
use futures::StreamExt;
use futures::TryFutureExt;
use itertools::Itertools;
use model_entity::{Entity, EntityType};
use tokio::sync::mpsc::Sender;
use tracing::Level;

use super::sender::send_message_to_entity;

/// Convert TrackAction to FrecencyAction
fn to_frecency_action(action: TrackAction) -> FrecencyAction {
    match action {
        TrackAction::Open => FrecencyAction::Open,
        TrackAction::Ping => FrecencyAction::Ping,
        TrackAction::Close => FrecencyAction::Close,
    }
}

pub async fn track_entity(
    sender: &Sender<OutgoingMessage>,
    ctx: ConnectionContext<'_>,
    data: TrackingData<'_>,
) -> Result<()> {
    // Convert TrackingData to FrecencyEvent for the frecency service
    let frecency_event = FrecencyEvent {
        entity: FrecencyEntity {
            user_id: data.entity.user_id.clone(),
            entity: data.entity.extra.extra.clone(),
        },
        action: to_frecency_action(data.action),
    };
    let fut = ctx
        .api_context
        .frecency_ingestor_service
        .track_event(EventRecord::new(frecency_event));

    match data.action {
        TrackAction::Open => {
            ctx.api_context
                .connection_manager
                .add_connection_entity(data.entity.clone())
                .await
                .ok();
            let mut item_stream = ctx
                .api_context
                .stream_manager
                .subscribe(
                    ctx.connection_id.to_owned(),
                    data.entity.extra.extra.entity_id.to_string(),
                )
                .await?;
            let sender = sender.to_owned();
            tokio::spawn(async move {
                while let Some(item) = item_stream.next().await {
                    let Ok(msg) = OutgoingMessage::try_from(item) else {
                        tracing::warn!("stream item conversion failed, skipping");
                        continue;
                    };
                    if sender.send(msg).await.is_err() {
                        break;
                    }
                }
            });
        }
        TrackAction::Close => {
            ctx.api_context
                .connection_manager
                .remove_connection_entity(&data.entity.extra)
                .await
                .ok();

            ctx.api_context
                .stream_manager
                .unsubscribe(ctx.connection_id.to_owned())
                .await?;
        }
        TrackAction::Ping => {
            ctx.api_context
                .connection_manager
                .refresh_connection_entity(&data.entity.extra)
                .await
                .ok();
        }
    };

    let fut2 = notify_tracking_change(ctx, &data.entity.extra.extra);
    // we don't try_join here in case 1 future fails we don't want to cancel the other one
    let (res1, res2) = tokio::join!(fut.map_err(anyhow::Error::from), fut2);
    res1?;
    res2?;

    Ok(())
}

pub async fn get_users_for_entity(
    ctx: ConnectionContext<'_>,
    entity: &Entity<'_>,
    threshold: Option<u64>,
) -> Result<Vec<String>> {
    if matches!(entity.entity_type, EntityType::User) {
        tracing::warn!("tried to request users for user entity... this should never happen");
        return Ok(vec![entity.entity_id.to_string()]);
    }

    let entries = ctx
        .api_context
        .connection_manager
        .get_entries_by_entity(entity)
        .await?;

    let user_ids = entries
        .into_iter()
        .filter_map(|entry| {
            if entry.is_active_in_threshold(threshold) {
                Some(entry.user_id)
            } else {
                None
            }
        })
        .unique()
        .collect::<Vec<String>>();

    Ok(user_ids)
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct UserTrackingChange {
    pub entity_type: EntityType,
    pub entity_id: String,
    pub user_ids: Vec<String>,
}

#[tracing::instrument(skip(ctx), err(level = Level::WARN))]
pub async fn notify_tracking_change(ctx: ConnectionContext<'_>, entity: &Entity<'_>) -> Result<()> {
    let users = get_users_for_entity(ctx, entity, Some(DEFAULT_TIMEOUT_THRESHOLD)).await?;

    let message: Message = Message {
        message_type: "user_tracking_change".to_string(),
        data: serde_json::to_string(&UserTrackingChange {
            entity_type: entity.entity_type,
            entity_id: entity.entity_id.to_string(),
            user_ids: users,
        })?,
    };

    send_message_to_entity(ctx, entity, message).await?;

    Ok(())
}
