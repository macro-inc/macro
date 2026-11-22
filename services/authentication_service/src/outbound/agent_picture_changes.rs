//! Publishes saved agent avatar changes through the existing profile event.

use macro_event_broker::MacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use team_agents::domain::ports::AgentPictureChanges;
use user_events::{UserMacroEvent, UserPictureChangedMetadata};

/// The event broker adapter for agent avatar saves.
pub struct BrokerAgentPictureChanges<B> {
    broker: B,
}

impl<B> BrokerAgentPictureChanges<B> {
    /// Use the auth service's existing event broker.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker> AgentPictureChanges for BrokerAgentPictureChanges<B> {
    #[tracing::instrument(skip_all)]
    fn picture_changed(&self, agent: &MacroUserIdStr<'_>, url: Option<&str>) {
        let event = UserMacroEvent::picture_changed(UserPictureChangedMetadata {
            user_id: agent.clone().into_owned(),
            file_id: None,
            url: url.map(str::to_owned),
        });
        let _ = self.broker.send_event(&event).inspect_err(|error| {
            tracing::warn!(error = ?error, "failed to publish agent avatar change");
        });
    }
}
