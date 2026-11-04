use crate::{
    constants::GRANT_REVALIDATION_INTERVAL,
    model::{
        connection::ConnectionContext,
        message::OutgoingMessage,
        tracking::{EntityConnectionExt, TrackAction, TrackingData},
        websocket::ToWebsocketMessage,
    },
    service::{
        entity_grants::{Admission, EntityGrants},
        fanout,
        stream_event::handle_stream_events,
        tracker,
    },
};
use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket};
use cowlike::CowLike;
use futures::{StreamExt, stream::SplitStream};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use tokio::{
    sync::mpsc::Sender,
    time::{Instant, MissedTickBehavior},
};

pub async fn handle_websocket_stream(
    connection_context: ConnectionContext<'_>,
    mut stream: SplitStream<WebSocket>,
    sender: Sender<OutgoingMessage>,
    mut grants: EntityGrants,
) -> Result<()> {
    let mut revalidation = tokio::time::interval_at(
        Instant::now() + GRANT_REVALIDATION_INTERVAL,
        GRANT_REVALIDATION_INTERVAL,
    );
    revalidation.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            msg = stream.next() => match msg {
                Some(Ok(msg)) => {
                    if let Err(e) =
                        handle_message(connection_context, msg, &sender, &mut grants).await
                    {
                        tracing::warn!(error=?e, "error handling message");
                    }
                }
                // A read error means the client went away without a close frame
                // (connection reset, broken pipe, no closing handshake).
                Some(Err(err)) => {
                    tracing::info!(
                        error = ?err,
                        connection_id = %connection_context.connection_id,
                        user_id       = %connection_context.user_context.user_id,
                        "web-socket closed with error",
                    );
                    break;
                }
                None => break,
            },
            _ = revalidation.tick() => {
                revoke_lost_grants(connection_context, &sender, &mut grants).await;
            }
        }
    }

    Ok(())
}

const PING_MESSAGE: &str = "ping";

pub async fn handle_message(
    connection_context: ConnectionContext<'_>,
    message: Message,
    sender: &Sender<OutgoingMessage>,
    grants: &mut EntityGrants,
) -> Result<()> {
    // Every client frame is republished to the fanout channel, unparsed,
    // before any in-gateway handling. Backend services consume what they care
    // about (the sync tier reads binary frames); the gateway stays a dumb tap.
    //
    // TODO: the in-gateway handling below (entity tracking / frecency,
    // stream-event subscriptions) should probably migrate to services
    // consuming this same fanout, keeping the gateway a pure edge.
    match &message {
        Message::Text(text) => {
            fanout::frame(&connection_context, true, text.as_bytes().to_vec()).await;
        }
        Message::Binary(payload) => {
            fanout::frame(&connection_context, false, payload.to_vec()).await;
            // Binary frames have no in-gateway handling; fanout is it.
            return Ok(());
        }
        _ => {}
    }

    let text_message = match message {
        Message::Text(text) => Some(text),
        Message::Ping(_) | Message::Pong(_) => return Ok(()),
        Message::Close(_) => {
            tracing::debug!("websocket connection closed naturally");
            return Ok(());
        }
        _ => None,
    }
    .context("messages is not text")?;

    // Handle incoming ping messages
    if text_message.trim() == PING_MESSAGE {
        // Refresh last-online timestamp so long-lived connections don't appear offline
        if let Ok(user_id) =
            MacroUserIdStr::parse_from_str(&connection_context.user_context.user_id)
        {
            connection_context
                .api_context
                .last_online_worker
                .record_online(user_id.into_owned());
        }
        sender.send(OutgoingMessage::Pong).await?;
        return Ok(());
    }

    let parsed_message = serde_json::from_str::<ToWebsocketMessage>(&text_message)
        .context("unable to parse message")?;

    let access = connection_context.api_context.entity_access.as_ref();
    match parsed_message {
        ToWebsocketMessage::TrackEntityMessage(message) => {
            let entity = message.extra;
            match grants.admit(access, &entity, message.action).await {
                Ok(Admission::Admitted) => {
                    track(connection_context, sender, &entity, message.action).await;
                }
                Ok(Admission::Refused) => {
                    log_refused(connection_context, &entity, message.action.into());
                }
                Ok(Admission::Revoked) => {
                    log_refused(connection_context, &entity, message.action.into());
                    track(connection_context, sender, &entity, TrackAction::Close).await;
                }
                Err(error) => log_check_failed(connection_context, &entity, &error),
            }
        }
        ToWebsocketMessage::StreamEvents(message) => {
            match grants.permits(access, &message.entity).await {
                Ok(true) => {
                    let entity = message.entity.clone();
                    let listener =
                        handle_stream_events(connection_context, sender.clone(), message);
                    grants.hold_stream_listener(&entity, listener);
                }
                Ok(false) => log_refused(connection_context, &message.entity, "stream_events"),
                Err(error) => log_check_failed(connection_context, &message.entity, &error),
            }
        }
    };

    Ok(())
}

async fn track(
    connection_context: ConnectionContext<'_>,
    sender: &Sender<OutgoingMessage>,
    entity: &Entity<'_>,
    action: TrackAction,
) {
    tracker::track_entity(
        sender,
        connection_context,
        TrackingData {
            entity: entity
                .copied()
                .with_connection_str(connection_context.connection_id)
                .with_user_str(&connection_context.user_context.user_id),
            action,
        },
    )
    .await
    .ok();
}

/// Tears down subscriptions to entities the user can no longer view.
async fn revoke_lost_grants(
    connection_context: ConnectionContext<'_>,
    sender: &Sender<OutgoingMessage>,
    grants: &mut EntityGrants,
) {
    let access = connection_context.api_context.entity_access.as_ref();
    for entity in grants.revalidate(access).await {
        log_refused(connection_context, &entity, "revalidation");
        track(connection_context, sender, &entity, TrackAction::Close).await;
    }
}

fn log_refused(connection_context: ConnectionContext<'_>, entity: &Entity<'_>, frame: &str) {
    tracing::warn!(
        connection_id = %connection_context.connection_id,
        entity_type = %entity.entity_type,
        entity_id = %entity.entity_id,
        frame,
        "refused an entity subscription the user cannot view"
    );
}

fn log_check_failed(
    connection_context: ConnectionContext<'_>,
    entity: &Entity<'_>,
    error: &entity_access::domain::models::AccessError,
) {
    tracing::error!(
        error = ?error,
        connection_id = %connection_context.connection_id,
        entity_type = %entity.entity_type,
        entity_id = %entity.entity_id,
        "could not check entity access; dropped the subscription frame"
    );
}
