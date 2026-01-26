//! WebSocket gateway adapter for real-time notification delivery.

use std::collections::HashSet;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::models::Notification;
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
    fn send_to_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
        payload: &[u8],
    ) -> impl std::future::Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;
}

impl<W: WebSocketGatewayOps + Send + Sync> WebSocketSender for WebSocketGatewayAdapter<W> {
    async fn send_notifications<'a, T: Notification + Send + Sync>(
        &self,
        notifications: Vec<(MacroUserIdStr<'a>, &T)>,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        // Get the first notification to serialize, return empty if none
        let Some((_, notification)) = notifications.first() else {
            return Ok(HashSet::new());
        };

        let user_ids: Vec<_> = notifications.iter().map(|(id, _)| id.clone()).collect();

        // Serialize the notification payload
        let payload = serde_json::to_vec(notification).map_err(Report::new)?;

        self.gateway.send_to_users(&user_ids, &payload).await
    }
}
