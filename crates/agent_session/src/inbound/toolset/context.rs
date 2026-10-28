//! Context resolved from the calling session credential.

use std::sync::Arc;

use crate::domain::{
    model::AgentSessionId, pull_request::SessionPullRequests, session_task::SessionTasks,
};

/// A session-bound tool context. The caller supplies only the tool arguments.
#[derive(Clone)]
pub struct SessionToolContext {
    /// Shared session operation.
    pub service: Arc<dyn SessionPullRequests>,
    /// The session's task.
    pub tasks: Arc<dyn SessionTasks>,
    /// Session resolved from the request credential.
    pub session: AgentSessionId,
}
