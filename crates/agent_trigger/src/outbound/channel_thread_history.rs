//! Thread history assembled from the channels repository.

use agent_session::domain::error::{AgentSessionError, Result};
use channel_sender::ChannelSender;
use channels::domain::ports::ChannelRepo;
use macro_uuid::Uuid;

use crate::domain::service::ThreadHistory;
use crate::domain::thread_window::ThreadMessage;

/// Reads a thread as its root message followed by its replies.
pub struct ChannelThreadHistory<Repo> {
    repo: Repo,
}

impl<Repo> ChannelThreadHistory<Repo> {
    /// Creates a reader over the given channels repository.
    pub const fn new(repo: Repo) -> Self {
        Self { repo }
    }
}

/// A sender that will not parse drops its message rather than failing the
/// read: one unreadable row must not blind the judge to the whole thread.
fn thread_message(
    id: Uuid,
    sender_id: String,
    content: String,
    created_at: chrono::DateTime<chrono::Utc>,
) -> Option<ThreadMessage> {
    let sender = ChannelSender::try_from(sender_id)
        .inspect_err(|error| {
            tracing::warn!(error = ?error, message_id = %id, "skipping thread message with an unparseable sender");
        })
        .ok()?;
    Some(ThreadMessage {
        id,
        sender,
        content,
        created_at,
    })
}

impl<Repo> ThreadHistory for ChannelThreadHistory<Repo>
where
    Repo: ChannelRepo,
{
    async fn thread_messages(
        &self,
        channel_id: Uuid,
        thread_id: Uuid,
    ) -> Result<Vec<ThreadMessage>> {
        // The root is not one of its own replies, and it is where the mention
        // that opened the session lives.
        let root = self
            .repo
            .resolve_top_level_parent(channel_id, thread_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?
            .filter(|root| root.deleted_at.is_none())
            .and_then(|root| {
                thread_message(root.id, root.sender_id, root.content, root.created_at)
            });

        let replies = self
            .repo
            .get_thread_replies(thread_id)
            .await
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;

        Ok(root
            .into_iter()
            .chain(replies.into_iter().filter_map(|reply| {
                thread_message(reply.id, reply.sender_id, reply.content, reply.created_at)
            }))
            .collect())
    }
}
