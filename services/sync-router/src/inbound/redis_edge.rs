//! Consume the connection gateway's Redis fanout and translate it into
//! [`EdgeEvent`]s. All Redis-isms (heartbeats, gateway liveness, text-frame
//! filtering) are absorbed here; the router core never sees them.

#[cfg(test)]
mod test;

use crate::domain::models::{ConnectionId, EdgeEvent, Event};
use anyhow::{Context, Result};
use connection_gateway_models::fanout::{
    FromGateway, GatewayId, HEARTBEAT_INTERVAL_SECS, INBOUND_CHANNEL,
};
use futures::StreamExt;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::{debug, warn};

/// A gateway instance is declared dead after this long without a heartbeat
/// (or any other message from it).
const GATEWAY_STALE_AFTER: Duration = Duration::from_secs(HEARTBEAT_INTERVAL_SECS * 3);

/// Subscribe to the fanout channel and pump events until Redis drops us.
/// The caller is expected to reconnect-and-rerun on exit.
pub async fn run(redis_client: &redis::Client, events: mpsc::Sender<Event>) -> Result<()> {
    let mut pubsub = redis_client
        .get_async_pubsub()
        .await
        .context("failed to open redis pubsub connection")?;
    pubsub
        .subscribe(INBOUND_CHANNEL)
        .await
        .context("failed to subscribe to fanout channel")?;
    debug!(channel = INBOUND_CHANNEL, "subscribed to gateway fanout");

    let mut liveness: HashMap<GatewayId, Instant> = HashMap::new();
    let mut sweep = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    let mut stream = pubsub.on_message();

    loop {
        tokio::select! {
            message = stream.next() => {
                let Some(message) = message else {
                    // Redis connection died; surface it so main reconnects.
                    anyhow::bail!("fanout pubsub stream ended");
                };
                let payload: Vec<u8> = match message.get_payload() {
                    Ok(payload) => payload,
                    Err(error) => {
                        warn!(error = ?error, "unreadable fanout payload; skipping");
                        continue;
                    }
                };
                let decoded: FromGateway = match postcard::from_bytes(&payload) {
                    Ok(decoded) => decoded,
                    Err(error) => {
                        warn!(error = ?error, "undecodable fanout message; skipping");
                        continue;
                    }
                };
                if let Some(event) = translate(decoded, &mut liveness)
                    && events.send(event).await.is_err()
                {
                    return Ok(()); // router shut down
                }
            }
            _ = sweep.tick() => {
                let now = Instant::now();
                let stale: Vec<GatewayId> = liveness
                    .iter()
                    .filter(|(_, seen)| now.duration_since(**seen) > GATEWAY_STALE_AFTER)
                    .map(|(gateway, _)| gateway.clone())
                    .collect();
                for gateway in stale {
                    warn!(gateway = %gateway, "gateway heartbeat went quiet; dropping its connections");
                    liveness.remove(&gateway);
                    if events
                        .send(Event::Edge(EdgeEvent::GatewayLost { gateway }))
                        .await
                        .is_err()
                    {
                        return Ok(());
                    }
                }
            }
        }
    }
}

/// Turn one fanout message into an edge event, updating gateway liveness.
/// Returns `None` for messages the router doesn't act on (text frames,
/// heartbeats, `Connected` — the router keys everything off `Subscribe`).
fn translate(message: FromGateway, liveness: &mut HashMap<GatewayId, Instant>) -> Option<Event> {
    let mark = |liveness: &mut HashMap<GatewayId, Instant>, gateway: &GatewayId| {
        liveness.insert(gateway.clone(), Instant::now());
    };
    match message {
        FromGateway::Heartbeat { gateway } => {
            mark(liveness, &gateway);
            None
        }
        FromGateway::Connected { gateway, .. } => {
            mark(liveness, &gateway);
            None
        }
        FromGateway::Frame {
            gateway,
            conn,
            text,
            payload,
        } => {
            mark(liveness, &gateway);
            if text {
                return None; // existing gateway JSON traffic, not ours
            }
            Some(Event::Edge(EdgeEvent::Frame {
                conn: ConnectionId { gateway, conn },
                payload,
            }))
        }
        FromGateway::Disconnected { gateway, conn } => {
            mark(liveness, &gateway);
            Some(Event::Edge(EdgeEvent::Disconnected {
                conn: ConnectionId { gateway, conn },
            }))
        }
    }
}
