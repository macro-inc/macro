//! A decorator over the agent session repository that mirrors durable
//! session changes onto `macro.agent_sessions` as lifecycle facts.
//!
//! Soup realtime (and anyone else listing sessions) follows these events to
//! know a session row was created, changed, or deleted, without polling.
//! Publication is best-effort by design: the durable write is the source of
//! truth and has already succeeded, so a failed publish costs a follower some
//! liveness until their next fetch, never the write.

use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use agent_session::domain::error::Result;
use agent_session::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSession, CreateAgentSessionParams,
    Message, SessionBot, StoredAgentSessionLog,
};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};
use agent_trigger::domain::broker_events::{AgentSessionLifecycleMetadata, AgentSessionMacroEvent};
use bot_id::BotId;
use macro_event_broker::MacroEventBroker;
use macro_uuid::Uuid;

/// Wraps an [`AgentSessionRepo`] + [`AgentSessionLogRepo`] and publishes a
/// lifecycle fact after every durable change.
#[derive(Debug, Clone)]
pub struct EventedAgentSessionRepo<R, B> {
    repo: R,
    broker: B,
}

impl<R, B> EventedAgentSessionRepo<R, B>
where
    B: MacroEventBroker,
{
    /// Wrap `repo`, mirroring its writes through `broker`.
    pub fn new(repo: R, broker: B) -> Self {
        Self { repo, broker }
    }

    /// Fire one lifecycle fact, logging rather than failing: the durable
    /// write already succeeded and is not this event's to undo.
    fn publish(&self, session_id: AgentSessionId, event: LifecycleKind, owner_id: Option<String>) {
        let metadata = AgentSessionLifecycleMetadata {
            session_id,
            owner_id,
        };
        let event = match event {
            LifecycleKind::Created => AgentSessionMacroEvent::session_created(metadata),
            LifecycleKind::Updated => AgentSessionMacroEvent::session_updated(metadata),
            LifecycleKind::Deleted => AgentSessionMacroEvent::session_deleted(metadata),
        };
        if let Err(error) = self.broker.send_event(&event) {
            tracing::error!(
                error = ?error,
                %session_id,
                "failed to publish an agent session lifecycle event"
            );
        }
    }

    /// An update whose row we did not read back: the owner is not at hand,
    /// and the consumer resolves the audience from `entity_access` anyway.
    fn publish_updated(&self, session_id: AgentSessionId) {
        self.publish(session_id, LifecycleKind::Updated, None);
    }
}

#[derive(Debug, Clone, Copy)]
enum LifecycleKind {
    Created,
    Updated,
    Deleted,
}

impl<R, B> AgentSessionRepo for EventedAgentSessionRepo<R, B>
where
    R: AgentSessionRepo,
    B: MacroEventBroker + Clone,
{
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        let session = self.repo.create(params).await?;
        self.publish(
            session.id,
            LifecycleKind::Created,
            Some(session.owner_id.to_string()),
        );
        Ok(session)
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        self.repo.find_for_channel(thread_id, bot_id).await
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        self.repo.session_bot(id).await
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        self.repo.set_acp_session_id(id, acp_session_id).await?;
        self.publish_updated(id);
        Ok(())
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<bool> {
        let changed = self.repo.set_model(id, model).await?;
        if changed {
            self.publish_updated(id);
        }
        Ok(changed)
    }

    async fn set_title(&self, id: AgentSessionId, title: Option<String>) -> Result<bool> {
        let changed = self.repo.set_title(id, title).await?;
        if changed {
            self.publish_updated(id);
        }
        Ok(changed)
    }

    async fn set_pending_permission_count(&self, id: AgentSessionId, count: i32) -> Result<bool> {
        let changed = self.repo.set_pending_permission_count(id, count).await?;
        if changed {
            self.publish_updated(id);
        }
        Ok(changed)
    }

    async fn set_pr_url(&self, id: AgentSessionId, pr_url: Option<String>) -> Result<bool> {
        let changed = self.repo.set_pr_url(id, pr_url).await?;
        if changed {
            self.publish_updated(id);
        }
        Ok(changed)
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await?;
        self.publish(id, LifecycleKind::Deleted, None);
        Ok(())
    }
}

impl<R, B> AgentSessionLogRepo for EventedAgentSessionRepo<R, B>
where
    R: AgentSessionLogRepo,
    B: MacroEventBroker + Clone,
{
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        // Only a lifecycle event frame moves the row (status +
        // modified_at); the ACP chunks that make up the bulk of a log
        // change nothing a session list renders, and mirroring each of
        // them would flood the topic.
        let row_changed = matches!(
            log.content,
            Message::ToServer(ToServerMessage::Event { .. })
        );
        let session_id = log.agent_session_id;
        let stored = self.repo.create(log).await?;
        if row_changed {
            self.publish_updated(session_id);
        }
        Ok(stored)
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        self.repo.list_by_session(agent_session_id).await
    }
}
