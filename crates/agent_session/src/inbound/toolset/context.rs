//! Context resolved from the calling session credential.

use std::sync::Arc;

use crate::domain::{model::AgentSessionId, pull_request::SessionPullRequests};

/// A session-bound tool context. The caller supplies only a URL.
#[derive(Clone)]
pub struct SessionToolContext {
    /// Shared session operation.
    pub service: Arc<dyn SessionPullRequests>,
    /// Session resolved from the request credential.
    pub session: AgentSessionId,
}
