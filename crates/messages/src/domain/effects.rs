//! Failure-isolated delivery of committed facts to independent targets.
use super::ports::{MessageChange, MessageEvent, MessageEventPublisher};

/// Fixed sibling effects: remote agents, local agents, and parent-specific delivery.
/// Sharing and recipient ordering remain inside each parent's domain policy.
#[derive(Clone)]
pub struct MessageEffects<Remote, Local, Parent> {
    remote_agents: Remote,
    local_agents: Local,
    parent: Parent,
}
impl<Remote, Local, Parent> MessageEffects<Remote, Local, Parent> {
    /// Compose delivery targets without making one target responsible for another.
    pub const fn new(remote_agents: Remote, local_agents: Local, parent: Parent) -> Self {
        Self {
            remote_agents,
            local_agents,
            parent,
        }
    }
}
impl<Remote: MessageEventPublisher, Local: MessageEventPublisher, Parent: MessageEventPublisher>
    MessageEventPublisher for MessageEffects<Remote, Local, Parent>
{
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        // Typing is ephemeral; it does not enter agent event delivery.
        if matches!(event.change, MessageChange::Typing { .. }) {
            return self.parent.publish(event).await;
        }
        let mut first_error = None;
        for (target, result) in [
            (
                "remote_agents",
                self.remote_agents.publish(event.clone()).await,
            ),
            (
                "local_agents",
                self.local_agents.publish(event.clone()).await,
            ),
            ("parent", self.parent.publish(event).await),
        ] {
            if let Err(error) = result.inspect_err(|error| {
                tracing::error!(error=?error, target, "message delivery target failed");
            }) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

#[cfg(test)]
mod test;
