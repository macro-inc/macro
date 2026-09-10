//! Publishing a session's lifecycle facts: who the session is, and what the
//! agent last said.

use agent_fold::domain::model::{Author, MessagePart};
use agent_session::domain::lifecycle::session_identity;
use agent_session_events::{AgentSessionLifecycleEvent, SessionIdentity, SessionOpenedMetadata};

use super::*;

/// The most of the agent's last text a `settled` event carries.
const SETTLED_EXCERPT_MAX_CHARS: usize = 280;

impl<Sessions, Containers, Announcer, Runtimes, PromptContext, PromptComposer, Egress>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
    >
where
    Sessions: AgentSessionService,
    Containers: ContainerManager,
    Announcer: SessionAnnouncer,
    Runtimes: RuntimeConnections,
    PromptContext: ChannelPromptContext,
    PromptComposer: AgentPromptComposer,
    Egress: SandboxEgressProvisioner,
{
    /// The identity block for one session, from its row and its bot.
    pub(super) async fn identity(&self, session_id: AgentSessionId) -> Result<SessionIdentity> {
        let session = self.sessions.get_session(session_id).await?;
        self.identity_of(&session).await
    }

    /// The identity block for a session whose row is already in hand.
    pub(super) async fn identity_of(&self, session: &AgentSession) -> Result<SessionIdentity> {
        let bot = self.sessions.session_bot(session.bot_id).await?;
        Ok(session_identity(session, &bot))
    }

    /// Publish one fact about `session_id`, built once its identity is known.
    ///
    /// Never fails the command it rides on: a session whose identity cannot be
    /// loaded is logged and skipped, because the fact itself already happened.
    pub(super) async fn publish_lifecycle(
        &self,
        session_id: AgentSessionId,
        build: impl FnOnce(SessionIdentity) -> AgentSessionLifecycleEvent,
    ) {
        match self.identity(session_id).await {
            Ok(identity) => self.lifecycle_publisher.publish(build(identity)).await,
            Err(error) => tracing::warn!(
                error = ?error,
                %session_id,
                "skipping agent session lifecycle event: identity unavailable"
            ),
        }
    }

    /// Publish `agent_session.opened` for a row just created.
    pub(super) async fn publish_opened(&self, session: &AgentSession) {
        match self.identity_of(session).await {
            Ok(identity) => {
                self.lifecycle_publisher
                    .publish(AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
                        identity,
                        model: session.model.clone(),
                        harness: session.harness.clone(),
                    }))
                    .await;
            }
            Err(error) => tracing::warn!(
                error = ?error,
                session_id = %session.id,
                "skipping agent_session.opened: identity unavailable"
            ),
        }
    }

    /// The tail of the agent's last text in the session, for `settled`.
    ///
    /// `None` when the agent wrote no prose, and when the log cannot be read:
    /// the excerpt is a courtesy, and `settled` must still go out without it.
    pub(super) async fn settled_excerpt(&self, session_id: AgentSessionId) -> Option<String> {
        let messages = match self.sessions.folded_messages(session_id).await {
            Ok(messages) => messages,
            Err(error) => {
                tracing::warn!(error = ?error, %session_id, "settled without an excerpt");
                return None;
            }
        };
        let last_agent_text = messages
            .iter()
            .rev()
            .find(|message| matches!(message.author, Author::Agent { .. }))?
            .parts
            .iter()
            .rev()
            .find_map(|part| match part {
                MessagePart::Text { text } => Some(text.trim()),
                _ => None,
            })
            .filter(|text| !text.is_empty())?;
        Some(truncate_chars(last_agent_text, SETTLED_EXCERPT_MAX_CHARS))
    }
}

/// The first `max_chars` scalar values of `text`, on a character boundary.
fn truncate_chars(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => text[..end].to_owned(),
        None => text.to_owned(),
    }
}

#[cfg(test)]
mod test {
    use super::truncate_chars;

    #[test]
    fn truncation_counts_characters_not_bytes() {
        assert_eq!(truncate_chars("héllo", 3), "hél");
        assert_eq!(truncate_chars("short", 10), "short");
        assert_eq!(truncate_chars("", 3), "");
    }
}
