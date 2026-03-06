use std::collections::HashSet;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::ports::WebSocketSender;
use rootcause::Report;
use serde::Serialize;

/// WebSocket sender that logs delivery info instead of sending.
pub struct LoggingWebSocketSender;

impl WebSocketSender for LoggingWebSocketSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        _notification: &T,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        println!(
            "  [egress] WebSocket: delivered to {} recipient(s)",
            recipients.len()
        );
        Ok(recipients.iter().map(|r| r.clone().into_owned()).collect())
    }
}
