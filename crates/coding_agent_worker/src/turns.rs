//! Which agent turns are running, read off the ACP wire.
//!
//! A turn is a `session/prompt` request the agent has not answered yet. The
//! self-updater restarts macrod only while none is outstanding.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};

use agent_client_protocol::LineDirection;
use tokio::sync::watch;

#[cfg(test)]
mod test;

/// The ids of prompt requests sent to the ACP agent and not yet answered.
#[derive(Clone)]
pub struct ActiveTurns {
    prompt_ids: Arc<Mutex<HashSet<String>>>,
    /// How many are open, for the agent monitor.
    open: watch::Sender<usize>,
}

impl Default for ActiveTurns {
    fn default() -> Self {
        Self {
            prompt_ids: Arc::default(),
            open: watch::Sender::new(0),
        }
    }
}

/// The JSON-RPC fields that say whether a line starts or ends a turn.
#[derive(serde::Deserialize)]
struct RpcLine {
    id: Option<serde_json::Value>,
    method: Option<String>,
}

impl ActiveTurns {
    /// Record a line crossing the agent's stdio: a prompt request starts a
    /// turn, the response with the same id ends it.
    pub fn observe(&self, line: &str, direction: LineDirection) {
        let mut prompt_ids = self
            .prompt_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        match direction {
            LineDirection::Stdin => {
                if !line.contains("session/prompt") {
                    return;
                }
                if let Ok(RpcLine {
                    id: Some(id),
                    method: Some(method),
                }) = serde_json::from_str(line)
                    && method == "session/prompt"
                {
                    prompt_ids.insert(id.to_string());
                    self.open.send_replace(prompt_ids.len());
                }
            }
            LineDirection::Stdout => {
                if prompt_ids.is_empty() {
                    return;
                }
                if let Ok(RpcLine {
                    id: Some(id),
                    method: None,
                }) = serde_json::from_str(line)
                    && prompt_ids.remove(&id.to_string())
                {
                    self.open.send_replace(prompt_ids.len());
                }
            }
            LineDirection::Stderr => {}
        }
    }

    /// The agent process ended: none of its turns can still be running.
    pub fn clear(&self) {
        self.prompt_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        self.open.send_replace(0);
    }

    /// The prompt ids still running, to hand to the next process image.
    pub fn snapshot(&self) -> Vec<String> {
        self.prompt_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .cloned()
            .collect()
    }

    /// Continue tracking turns an earlier process image saw start.
    pub fn restore(&self, prompt_ids: impl IntoIterator<Item = String>) {
        let mut open = self
            .prompt_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        open.extend(prompt_ids);
        self.open.send_replace(open.len());
    }

    /// How many turns are running, as it changes.
    #[cfg_attr(not(unix), expect(dead_code, reason = "the agent monitor is Unix only"))]
    pub fn open_count(&self) -> watch::Receiver<usize> {
        self.open.subscribe()
    }

    /// Whether no turn is running.
    pub fn is_idle(&self) -> bool {
        self.prompt_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_empty()
    }
}
