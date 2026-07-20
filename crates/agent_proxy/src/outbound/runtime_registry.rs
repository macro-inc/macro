//! In-memory registry of live agent runtime sessions.

#[cfg(test)]
mod test;

use crate::domain::models::{AgentProxyErr, Result};
use crate::domain::ports::{AcpSender, RegistrationId, RuntimeSessions, SessionAttachments};
use agent_client_protocol::RawJsonRpcMessage;
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

struct SessionHandle {
    /// The connection epoch that installed this registration; a registration
    /// from an older epoch never displaces a newer one.
    epoch: u64,
    registration: RegistrationId,
    tx: AcpSender,
}

/// Maps session (agent entity) IDs to the live ACP channel of the runtime
/// currently hosting them. Implements the [`RuntimeSessions`] and
/// [`SessionAttachments`] domain ports.
#[derive(Default)]
pub struct SessionRegistry {
    next_registration: AtomicU64,
    sessions: Mutex<HashMap<Uuid, SessionHandle>>,
}

impl SessionRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self::default()
    }
}

impl SessionAttachments for SessionRegistry {
    fn register(&self, session_id: Uuid, epoch: u64, tx: AcpSender) -> Option<RegistrationId> {
        let mut sessions = self.sessions.lock().expect("session registry poisoned");
        if sessions
            .get(&session_id)
            .is_some_and(|handle| handle.epoch > epoch)
        {
            return None;
        }
        let registration = RegistrationId(self.next_registration.fetch_add(1, Ordering::Relaxed));
        sessions.insert(
            session_id,
            SessionHandle {
                epoch,
                registration,
                tx,
            },
        );
        Some(registration)
    }

    fn unregister(&self, session_id: Uuid, registration: RegistrationId) -> bool {
        let mut sessions = self.sessions.lock().expect("session registry poisoned");
        let owns = sessions
            .get(&session_id)
            .is_some_and(|handle| handle.registration == registration);
        if owns {
            sessions.remove(&session_id);
        }
        owns
    }
}

impl RuntimeSessions for SessionRegistry {
    fn send(&self, session_id: Uuid, message: RawJsonRpcMessage) -> Result<()> {
        let sessions = self.sessions.lock().expect("session registry poisoned");
        let handle = sessions
            .get(&session_id)
            .ok_or(AgentProxyErr::SessionNotConnected)?;
        handle
            .tx
            .unbounded_send(Ok(message))
            .map_err(|_| AgentProxyErr::SessionNotConnected)
    }

    fn is_connected(&self, session_id: Uuid) -> bool {
        self.sessions
            .lock()
            .expect("session registry poisoned")
            .contains_key(&session_id)
    }
}
