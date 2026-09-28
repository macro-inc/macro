//! Correlates provider permission requests with the existing ACP host policy.
use super::*;
use crate::domain::ports::ToolPermissions;
use std::collections::HashMap;
use tokio::sync::oneshot;

#[derive(Clone)]
pub(super) struct Permissions {
    tx: UnboundedSender<ToServerMessage>,
    session: String,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl Permissions {
    pub(super) fn new(tx: UnboundedSender<ToServerMessage>, session: String) -> Self {
        Self {
            tx,
            session,
            pending: Arc::default(),
        }
    }

    pub(super) fn respond(&self, frame: &Value) {
        let Some(id) = frame["id"].as_str() else {
            return;
        };
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));
        if let Some(sender) = sender {
            let outcome = &frame["result"]["outcome"];
            let allowed = outcome["outcome"] == "selected" && outcome["optionId"] == "allow_once";
            let _ = sender.send(allowed);
        }
    }
}

impl ToolPermissions for Permissions {
    async fn allow(&self, tool_id: &str, name: &str, input: &Value) -> Result<bool> {
        let id = format!("claude-permission-{}", uuid::Uuid::now_v7());
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| Error::Protocol)?
            .insert(id.clone(), sender);
        let sent = send(
            &self.tx,
            json!({
                "jsonrpc":"2.0", "id":id, "method":"session/request_permission",
                "params":{
                    "sessionId":self.session,
                    "toolCall":{"toolCallId":tool_id,"title":name,"status":"pending","rawInput":input},
                    "options":[
                        {"optionId":"allow_once","name":"Allow once","kind":"allow_once"},
                        {"optionId":"reject_once","name":"Reject","kind":"reject_once"}
                    ]
                }
            }),
        );
        let allowed = if sent.is_ok() {
            tokio::time::timeout(std::time::Duration::from_secs(60), receiver)
                .await
                .ok()
                .and_then(|result| result.ok())
                .unwrap_or(false)
        } else {
            false
        };
        self.pending
            .lock()
            .map_err(|_| Error::Protocol)?
            .remove(&id);
        Ok(allowed)
    }
}
