//! Announce sessions by posting into the mention's thread as the bot.
//!
//! Implements [`SessionAnnouncer`] over the channels domain's own
//! [`ChannelService`] port, so the post gets the full side-effect fan-out -
//! persistence, realtime, notifications, broker - exactly as if it came
//! through the channel API. The composition root decides which
//! `ChannelService` implementation (and side-effect stack) this wraps.
//!
//! The announcement quotes the prompting message above the session's magic
//! chip. The content is composed by the lexical service — the one place that
//! builds message markdown from real Lexical nodes — so this adapter never
//! formats markdown itself.

#[cfg(test)]
mod test;

use std::sync::Arc;

use bot_id::BotIdStr;
use channel_sender::ChannelSender;
use channels::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use channels::domain::ports::ChannelService;
use connection_gateway_client::ConnectionGatewayClient;
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::AgentAnnouncementChip;
use macro_db_client::annotations::create_comment::create_document_comment;
use model::annotations::AnnotationIncrementalUpdate;
use model::annotations::create::CreateCommentRequest;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{SessionAnnouncement, TaskSessionAnnouncement};
use crate::domain::ports::SessionAnnouncer;

/// Marks a comment thread as belonging to a document's discussion rather than
/// an inline annotation. Mirrors `DISCUSSION_MARK_PREFIX` in
/// `apps/web/src/features/block-md/comments/discussionResource.ts`, which is
/// what the task view filters discussion threads by.
const DISCUSSION_MARK_PREFIX: &str = "DISCUSSION:";

fn announcement_chip(announcement: &SessionAnnouncement) -> AgentAnnouncementChip {
    AgentAnnouncementChip {
        agent_session_id: announcement.session_id.to_string(),
        channel_id: None,
        prompted_message: announcement.prompted_message_id,
        status: "booting".to_owned(),
    }
}

fn task_announcement_chip(announcement: &TaskSessionAnnouncement) -> AgentAnnouncementChip {
    AgentAnnouncementChip {
        agent_session_id: announcement.session_id.to_string(),
        channel_id: None,
        prompted_message: announcement.prompted_message_id,
        status: "booting".to_owned(),
    }
}

/// Posts session announcements as their session's bot: channel-thread
/// announcements through a [`ChannelService`], task-assignment announcements
/// as a comment in the task's discussion.
pub struct ChannelAnnouncer<Channels> {
    channels: Arc<Channels>,
    lexical: LexicalClient,
    pool: sqlx::PgPool,
    gateway: Arc<ConnectionGatewayClient>,
}

impl<Channels> ChannelAnnouncer<Channels> {
    /// Post through `channels` (or, for task assignments, straight into the
    /// document comments in `pool`, pushing the live update through
    /// `gateway`), with content composed by `lexical`. The sender is
    /// per-announcement: whichever bot the session runs for.
    pub fn new(
        channels: Arc<Channels>,
        lexical: LexicalClient,
        pool: sqlx::PgPool,
        gateway: Arc<ConnectionGatewayClient>,
    ) -> Self {
        Self {
            channels,
            lexical,
            pool,
            gateway,
        }
    }
}

impl<Channels> SessionAnnouncer for ChannelAnnouncer<Channels>
where
    Channels: ChannelService + Send + Sync + 'static,
{
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<()> {
        let chip = announcement_chip(&announcement);
        let content = self
            .lexical
            .compose_agent_announcement(&announcement.prompted_content, &chip)
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        self.channels
            .post_message(
                ChannelSender::new_from_bot(announcement.bot_id),
                announcement.origin_channel_id,
                PostMessageRequest {
                    content,
                    mentions: Vec::new(),
                    thread_id: Some(announcement.origin_thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    notification_policy: PostMessageNotificationPolicy::default(),
                    // Attributed to whoever mentioned the bot, so the reply
                    // reads as their agent answering.
                    triggered_by: Some(announcement.triggered_by.as_ref().to_owned()),
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        Ok(())
    }

    async fn announce_task_assignment(&self, announcement: TaskSessionAnnouncement) -> Result<()> {
        let chip = task_announcement_chip(&announcement);
        let content = self
            .lexical
            .compose_agent_announcement(&announcement.prompted_content, &chip)
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        let sender = BotIdStr::from(announcement.bot_id);
        let task_id = announcement.task_id.to_string();
        let request = CreateCommentRequest {
            thread_id: None,
            thread_metadata: Some(serde_json::json!({
                "markId": format!("{DISCUSSION_MARK_PREFIX}{}", macro_uuid::Uuid::new_v4()),
            })),
            anchor: None,
            text: content,
            metadata: None,
            mentions: None,
        };
        let response = create_document_comment(&self.pool, &task_id, sender.as_ref(), &request)
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        // The same live update the comment API pushes, so an open task view
        // renders the chip without a refresh. Best-effort: the comment is
        // durable either way, and a viewer who reloads still sees it.
        match serde_json::to_value(AnnotationIncrementalUpdate::CreateComment {
            sender: sender.as_ref(),
            document_id: &task_id,
            response: &response,
        }) {
            Ok(update) => {
                let _ = self
                    .gateway
                    .batch_send_message(
                        "comment".to_owned(),
                        update,
                        vec![model_entity::EntityType::Document.with_entity_str(&task_id)],
                    )
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(
                            error = ?error,
                            task_id = %task_id,
                            "task announcement comment created, but its live update failed"
                        );
                    });
            }
            Err(error) => {
                tracing::warn!(error = ?error, "failed to serialize a comment live update");
            }
        }

        Ok(())
    }
}
