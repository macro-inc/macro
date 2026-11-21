//! Creates channel call thread roots through the message service.
use std::sync::{Arc, OnceLock};

use messages::domain::api::CallRootPoster;
use uuid::Uuid;

use crate::domain::ports::ChannelThreads;

/// The message service is built after the call service it sends to, so its
/// composition root fills this in once both exist.
pub type LateCallRootPoster = Arc<OnceLock<Arc<dyn CallRootPoster>>>;

/// [`ChannelThreads`] over the message service.
pub struct MessageChannelThreads {
    roots: LateCallRootPoster,
}

impl MessageChannelThreads {
    /// Bind the message service the thread roots are sent to.
    pub fn new(roots: LateCallRootPoster) -> Self {
        Self { roots }
    }
}

#[async_trait::async_trait]
impl ChannelThreads for MessageChannelThreads {
    async fn ensure_root(&self, call_id: Uuid) -> Result<(), rootcause::Report> {
        let roots = self
            .roots
            .get()
            .ok_or_else(|| rootcause::report!("the message service is not ready"))?;
        roots
            .ensure_call_root(call_id)
            .await
            .map_err(|error| rootcause::report!("failed to create the call root: {error}"))
    }
}
