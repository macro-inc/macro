//! Broker-publishing decorator over the agent session repositories.
//!
//! Wraps the Postgres adapter and announces durable session changes on
//! [`macro_event_topics::MacroAgentSessionsTopic`], so read models built
//! elsewhere — realtime Soup above all — learn that a session row was
//! created, changed, or deleted. Publication is fire-and-forget and never
//! fails the write it follows: the row is the source of truth and every
//! projection is rebuildable from it.

use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use agent_session::domain::error::Result;
use agent_session::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSession, CreateAgentSessionParams,
    Message, SessionBot, StoredAgentSessionLog,
};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use bot_id::BotId;
use macro_event_broker::MacroEventBroker;
use macro_uuid::Uuid;

/// An [`AgentSessionRepo`] / [`AgentSessionLogRepo`] that publishes a
/// lifecycle event after every successful durable change.
pub struct PublishingAgentSessionRepo<R, B> {
    inner: R,
    broker: B,
}

impl<R: Clone, B: Clone> Clone for PublishingAgentSessionRepo<R, B> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            broker: self.broker.clone(),
        }
    }
}

impl<R, B> PublishingAgentSessionRepo<R, B>
where
    B: MacroEventBroker,
{
    /// Wrap a repository so its successful writes are announced on the
    /// agent sessions topic.
    pub fn new(inner: R, broker: B) -> Self {
        Self { inner, broker }
    }

    /// Fire-and-forget: serialization is the only failure surfaced here, and
    /// even that only costs the announcement, never the write.
    fn publish(&self, event: AgentSessionMacroEvent) {
        if let Err(error) = self.broker.send_event(&event) {
            tracing::error!(error = ?error, "failed to publish agent session lifecycle event");
        }
    }
}

impl<R, B> AgentSessionRepo for PublishingAgentSessionRepo<R, B>
where
    R: AgentSessionRepo,
    B: MacroEventBroker + Clone,
{
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        let session = self.inner.create(params).await?;
        self.publish(AgentSessionMacroEvent::session_created(session.id));
        Ok(session)
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.inner.get(id).await
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        self.inner.find_for_channel(thread_id, bot_id).await
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        self.inner.session_bot(id).await
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        self.inner.set_acp_session_id(id, acp_session_id).await?;
        self.publish(AgentSessionMacroEvent::session_updated(id));
        Ok(())
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<bool> {
        let changed = self.inner.set_model(id, model).await?;
        if changed {
            self.publish(AgentSessionMacroEvent::session_updated(id));
        }
        Ok(changed)
    }

    async fn set_title(&self, id: AgentSessionId, title: Option<&str>) -> Result<bool> {
        let changed = self.inner.set_title(id, title).await?;
        if changed {
            self.publish(AgentSessionMacroEvent::session_updated(id));
        }
        Ok(changed)
    }

    async fn set_pending_permission_count(&self, id: AgentSessionId, count: i32) -> Result<bool> {
        let changed = self.inner.set_pending_permission_count(id, count).await?;
        if changed {
            self.publish(AgentSessionMacroEvent::session_updated(id));
        }
        Ok(changed)
    }

    async fn set_pr_url(&self, id: AgentSessionId, pr_url: Option<&str>) -> Result<bool> {
        let changed = self.inner.set_pr_url(id, pr_url).await?;
        if changed {
            self.publish(AgentSessionMacroEvent::session_updated(id));
        }
        Ok(changed)
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.inner.delete(id).await?;
        self.publish(AgentSessionMacroEvent::session_deleted(id));
        Ok(())
    }
}

impl<R, B> AgentSessionLogRepo for PublishingAgentSessionRepo<R, B>
where
    R: AgentSessionLogRepo,
    B: MacroEventBroker + Clone,
{
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        // System-event frames are the ones the log projection folds onto the
        // session row (`status` / `status_event_name` / `modified_at`); only
        // those move Soup-visible state, so only those are announced.
        // Permission and title changes are announced by their setters.
        let status_changed = matches!(
            log.content,
            Message::ToServer(ToServerMessage::Event { .. })
        );
        let session_id = log.agent_session_id;
        let stored = self.inner.create(log).await?;
        if status_changed {
            self.publish(AgentSessionMacroEvent::session_updated(session_id));
        }
        Ok(stored)
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        self.inner.list_by_session(agent_session_id).await
    }
}
