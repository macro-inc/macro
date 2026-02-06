//! WebSocket gateway adapter for real-time notification delivery.

use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use rootcause::Report;
use serde::Serialize;

use crate::domain::ports::WebSocketSender;

/// WebSocket gateway implementation of the WebSocket sender port.
///
/// This adapter sends notifications to users via WebSocket connections
/// through the connection gateway service.
pub struct WebSocketGatewayAdapter<W> {
    gateway: W,
}

impl<W> WebSocketGatewayAdapter<W> {
    /// Create a new WebSocket gateway adapter.
    pub fn new(gateway: W) -> Self {
        Self { gateway }
    }
}

/// Trait for WebSocket gateway operations.
///
/// This allows the adapter to work with different WebSocket gateway implementations.
pub trait WebSocketGatewayOps {
    /// Send a notification payload to users via WebSocket.
    ///
    /// Returns the set of user IDs that were successfully delivered to
    /// (i.e., users who had an active WebSocket connection).
    fn send_to_users<'a, T: Serialize + Send + Sync>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
        payload: &T,
    ) -> impl std::future::Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Receipt from the connection gateway indicating delivery status.
#[derive(serde::Deserialize, Debug)]
pub struct MessageReceipt {
    /// The user id of the user who received the message.
    pub user_id: String,
    /// The number of times the message was delivered to the user.
    pub delivery_count: u64,
}

/// Response from the connection gateway batch send endpoint.
#[derive(serde::Deserialize, Debug)]
struct GatewayResponse {
    receipts: Vec<MessageReceipt>,
}

/// Connection gateway client for sending WebSocket messages.
#[derive(Clone, Debug)]
pub struct ConnectionGatewayClient {
    connection_gateway_url: String,
    client: reqwest::Client,
}

impl ConnectionGatewayClient {
    /// Create a new connection gateway client.
    pub fn new(internal_auth_key: String, connection_gateway_url: String) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-internal-auth-key",
            internal_auth_key.parse().expect("valid header value"),
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .expect("client build should succeed");

        Self {
            connection_gateway_url,
            client,
        }
    }
}

/// Request body for batch sending messages.
#[derive(serde::Serialize)]
struct BatchSendMessageBody<'a> {
    message_type: &'a str,
    message: serde_json::Value,
    entities: Vec<Entity<'a>>,
}

impl WebSocketGatewayOps for ConnectionGatewayClient {
    #[tracing::instrument(err, skip(self, payload))]
    async fn send_to_users<'a, T: Serialize + Send + Sync>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
        payload: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        if user_ids.is_empty() {
            return Ok(HashSet::new());
        }

        let entities: Vec<Entity<'_>> = user_ids
            .iter()
            .map(|id| EntityType::User.with_entity_str(id.as_ref()))
            .collect();

        let body = BatchSendMessageBody {
            message_type: "notification",
            message: serde_json::to_value(payload)?,
            entities,
        };

        let res = self
            .client
            .post(format!(
                "{}/message/batch_send",
                self.connection_gateway_url
            ))
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let json = res.json().await?;
        let response: GatewayResponse = serde_json::from_value(json)?;

        // Convert receipts to user IDs that were delivered
        let delivered = response
            .receipts
            .into_iter()
            .filter(|r| r.delivery_count > 0)
            .filter_map(|r| {
                MacroUserIdStr::parse_from_str(&r.user_id)
                    .map(CowLike::into_owned)
                    .ok()
            })
            .collect();

        Ok(delivered)
    }
}

impl<W: WebSocketGatewayOps + Send + Sync + 'static> WebSocketSender
    for WebSocketGatewayAdapter<W>
{
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.gateway.send_to_users(recipients, notification).await
    }
}
