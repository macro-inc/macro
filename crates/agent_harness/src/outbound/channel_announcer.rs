//! Speak for an agent session in its originating thread through the shared
//! message service.
//!
//! Two shapes, by whether the session's bot is a coding agent: a coding
//! agent's turn is a magic chip, a live portal into the session that renders
//! the turn itself;
//! a chat agent's turn is a pending reply - the channel markdown's pulsing
//! await node - that is patched into the answer when the turn ends, the way
//! the original Macro bot replied, and that says so while the turn waits on
//! a question only the session view can answer. A chat agent's message
//! leads with a link to its session in every state. The domain decides the
//! shape, this module chooses the words, and Lexical composes every node:
//! no node syntax is written here.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_egress::domain::approval::MACRO_SERVER_SLUG;
use agent_fold::domain::model::{ActivityStatus, ProjectedSegment, SegmentKind, TurnId, TurnPhase};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{
    AgentActivityRow, AgentActivityStatus, AgentAnnouncementChip, AgentAnnouncementReplyTarget,
    AgentChatReply, AgentChatReplyBody, AgentConnectionChip, AgentConnectionPrompt,
    AgentReplySegment,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::MessageCommands,
    models::{
        MessageAttribution, MessageParent, PatchMessageNotificationPolicy, PostMessage,
        PostMessageNotificationPolicy,
    },
    ports::{AgentTyping, AgentTypingPhase, MessageError, MessagePatch},
    service::MessageWrite,
};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AgentTypingUpdate, AnnouncedMessage, DeclinedMention, HeldToolCall, ReplyOutcome,
    ReplyPresentation, ResolvedReply, SessionAnnouncement, SessionBlocker,
};
use crate::domain::ports::SessionAnnouncer;

const EMPTY_RESPONSE_FALLBACK: &str = "I wasn't able to come up with a response.";
const CANCELLED_FALLBACK: &str = "I stopped before finishing that.";
const ERROR_FALLBACK: &str = "Sorry — I ran into an error while responding.";
/// Introduces the agent's question when a turn stops to ask one. Only the
/// session view can answer it, and the link ahead of every reply is how the
/// reader gets there.
const NEEDS_INPUT_LEAD: &str =
    "I have a question before I can continue — open the agent session to answer it:";
/// Said instead of an answer the thread may not carry: one that mentions
/// something the person who asked cannot open, typically what a tool the
/// owner approved found with the owner's access. The answer is still in the
/// session, which the owner can read.
const UNSHAREABLE_ANSWER: &str = "My answer mentions things you can't open here, so it stays in \
    the agent session.";

/// A chat agent's message in one state, for Lexical to compose: the link to
/// its session, then `body`.
///
/// The channel message view lifts a leading session link out of the body
/// onto the sender line, and every state of the reply carries one: a patch
/// replaces the content wholesale, and a link only the pending reply had
/// would vanish with the spinner.
fn chat_reply(session_id: AgentSessionId, body: AgentChatReplyBody) -> AgentChatReply {
    AgentChatReply {
        session_id: session_id.to_string(),
        body,
        link: None,
    }
}

/// Largest card a message stores, serialized. A view is the model's own
/// arguments; one this large is a runaway, and its row still says what the
/// step did.
const MAX_STORED_CARD_BYTES: usize = 32 * 1024;

/// A step's card as a message stores it, unless it is too large to store.
fn stored_card(
    card: &agent_fold::domain::model::ActivityCard,
) -> Option<agent_fold::domain::model::ActivityCard> {
    let size = serde_json::to_vec(card).map_or(usize::MAX, |bytes| bytes.len());
    if size > MAX_STORED_CARD_BYTES {
        tracing::warn!(size, "dropping an activity card too large to store");
        return None;
    }
    Some(card.clone())
}

/// A reply's segments as the message composer takes them: passages as the
/// agent wrote them, and runs of steps with their rows. Requests for the
/// user are answered live and are not part of a message.
fn reply_segments(turn: TurnId, segments: &[ProjectedSegment]) -> Vec<AgentReplySegment> {
    segments
        .iter()
        .filter_map(|projected| match projected.segment.kind {
            SegmentKind::Prose => projected
                .text
                .clone()
                .map(|markdown| AgentReplySegment::Prose { markdown }),
            SegmentKind::Activity => Some(AgentReplySegment::Activity {
                turn: turn.0,
                segment: projected.segment.index,
                rows: projected
                    .segment
                    .rows
                    .iter()
                    .map(|row| AgentActivityRow {
                        id: row.id.clone(),
                        label: row.label.clone(),
                        detail: row.detail.clone(),
                        status: match row.status {
                            ActivityStatus::Running => AgentActivityStatus::Running,
                            ActivityStatus::Completed => AgentActivityStatus::Completed,
                            ActivityStatus::Failed => AgentActivityStatus::Failed,
                            ActivityStatus::Interrupted => AgentActivityStatus::Interrupted,
                        },
                        card: row.card.as_ref().and_then(stored_card),
                    })
                    .collect(),
                sealed: projected.segment.sealed,
            }),
            SegmentKind::Interaction => None,
        })
        .collect()
}

/// What a message showing a reply's segments says, with how the turn ended
/// or what it is waiting on. Never blank, like [`reply_body`]: a turn that
/// said nothing and did nothing is told as such.
fn segments_body(
    turn: TurnId,
    segments: &[ProjectedSegment],
    outcome: Option<&ReplyOutcome>,
    pending: bool,
) -> AgentChatReplyBody {
    let mut shown = reply_segments(turn, segments);
    let has_prose = shown
        .iter()
        .any(|segment| matches!(segment, AgentReplySegment::Prose { .. }));
    let mut pending = pending;
    let footer = match outcome {
        None => None,
        // The answer is the reply's last passage; told again only when the
        // segments do not carry it.
        Some(ReplyOutcome::Answered(text)) => {
            if !has_prose {
                shown.push(AgentReplySegment::Prose {
                    markdown: text.clone(),
                });
            }
            None
        }
        Some(ReplyOutcome::Empty) => {
            (!has_prose && shown.is_empty()).then(|| EMPTY_RESPONSE_FALLBACK.to_owned())
        }
        Some(ReplyOutcome::Cancelled) => Some(CANCELLED_FALLBACK.to_owned()),
        Some(ReplyOutcome::Failed) => Some(ERROR_FALLBACK.to_owned()),
        Some(ReplyOutcome::NeedsInput { question }) => {
            shown.push(AgentReplySegment::Prose {
                markdown: format!("{NEEDS_INPUT_LEAD}\n\n{question}"),
            });
            pending = false;
            None
        }
        // The steps so far, then who the turn waits on.
        Some(ReplyOutcome::AwaitingApproval(call)) => {
            pending = false;
            Some(awaiting_approval(call))
        }
        Some(ReplyOutcome::Resumed) => {
            pending = true;
            None
        }
    };
    AgentChatReplyBody::Segments {
        segments: shown,
        pending,
        footer,
    }
}

fn typing_phase(phase: TurnPhase) -> AgentTypingPhase {
    match phase {
        TurnPhase::Thinking => AgentTypingPhase::Thinking,
        TurnPhase::Writing => AgentTypingPhase::Writing,
        TurnPhase::Working => AgentTypingPhase::Working,
        TurnPhase::Waiting => AgentTypingPhase::Waiting,
    }
}

/// What a chat agent's pending reply becomes. Never blank: a turn that said
/// nothing is told as such rather than left as an empty message. A turn
/// waiting on its question shows the question, and one resumed after the
/// answer shows the spinner again.
fn reply_body(outcome: ReplyOutcome) -> AgentChatReplyBody {
    let markdown = match outcome {
        ReplyOutcome::Answered(text) => text,
        ReplyOutcome::Empty => EMPTY_RESPONSE_FALLBACK.to_owned(),
        ReplyOutcome::Cancelled => CANCELLED_FALLBACK.to_owned(),
        ReplyOutcome::Failed => ERROR_FALLBACK.to_owned(),
        ReplyOutcome::NeedsInput { question } => format!("{NEEDS_INPUT_LEAD}\n\n{question}"),
        ReplyOutcome::AwaitingApproval(call) => awaiting_approval(&call),
        ReplyOutcome::Resumed => return AgentChatReplyBody::Pending,
    };
    AgentChatReplyBody::Markdown { markdown }
}

/// What the thread reads while a tool call waits on the owner. Only the
/// owner can approve it, and they are notified on their own, so this names
/// the hold for everyone else rather than asking anything of them.
fn awaiting_approval(call: &HeldToolCall) -> String {
    let tool = &call.tool_name;
    if call.server_slug == MACRO_SERVER_SLUG {
        format!("Waiting for the session owner to allow `{tool}`.")
    } else {
        let server = &call.server_name;
        format!("Waiting for the session owner to allow `{tool}` from {server}.")
    }
}

/// Whether the thread should hear about a patch. The answer, and a question
/// only a person can unblock, are news the pending reply withheld; the
/// spinner coming back is not.
const fn patch_policy(outcome: &ReplyOutcome) -> PatchMessageNotificationPolicy {
    match outcome {
        ReplyOutcome::Answered(_)
        | ReplyOutcome::Empty
        | ReplyOutcome::Cancelled
        | ReplyOutcome::Failed
        | ReplyOutcome::NeedsInput { .. } => PatchMessageNotificationPolicy::NotifyAsPostedMessage,
        // The owner, the one person who can act, is notified by the hold.
        ReplyOutcome::AwaitingApproval(_) | ReplyOutcome::Resumed => {
            PatchMessageNotificationPolicy::Default
        }
    }
}

/// Describe the missing setup; Lexical owns the message and chip serialization.
fn connection_prompt(blocker: SessionBlocker) -> AgentConnectionPrompt {
    let (agent_tag, message, app_slug, name) = match blocker {
        SessionBlocker::CursorNotConnected => (
            "@cursor",
            "runs on your own Cursor account, and yours is not connected yet. Add your Cursor API key, then mention me again.",
            "cursor",
            "Cursor",
        ),
        SessionBlocker::CodexNotConnected => (
            "@codex",
            "runs on your own ChatGPT account. Connect Codex and select a cloud environment, then mention me again.",
            "codex-cloud",
            "Codex",
        ),
        SessionBlocker::CodexEnvironmentNotConfigured => (
            "@codex",
            "needs a cloud environment to run. Select an environment in Codex settings, then mention me again.",
            "codex-cloud",
            "Codex",
        ),
        SessionBlocker::ClaudeNotConnected => (
            "@claude",
            "runs on your own Claude account. Connect Claude, then mention me again.",
            "claude-cloud",
            "Claude",
        ),
    };
    AgentConnectionPrompt {
        agent_tag: agent_tag.to_owned(),
        message: message.to_owned(),
        chip: AgentConnectionChip {
            app_slug: app_slug.to_owned(),
            name: name.to_owned(),
            target: "harness".to_owned(),
        },
    }
}

fn announcement_chip(announcement: &SessionAnnouncement) -> AgentAnnouncementChip {
    AgentAnnouncementChip {
        agent_session_id: announcement.session_id.to_string(),
        channel_id: None,
        prompted_message: announcement.prompted_message_id,
        status: "booting".to_owned(),
    }
}

fn announcement_reply_target(announcement: &SessionAnnouncement) -> AgentAnnouncementReplyTarget {
    AgentAnnouncementReplyTarget {
        parent: announcement.origin_parent.clone(),
        channel_id: match &announcement.origin_parent {
            MessageParent::Channel(channel_id) => Some(channel_id.to_string()),
            MessageParent::Document(_)
            | MessageParent::Call(_)
            | MessageParent::Initiative(_)
            | MessageParent::CrmCompany(_)
            | MessageParent::CrmContact(_) => None,
        },
        target_message_id: announcement.origin_message_id.to_string(),
        target_thread_id: announcement.origin_thread_id.to_string(),
        display_text: announcement.prompted_content.clone(),
        sender_id: announcement.triggered_by.as_ref().to_owned(),
    }
}

/// Posts as the session bot with the invoking user's current parent capability.
pub struct MessageAnnouncer<Access> {
    messages: Arc<dyn MessageCommands>,
    access: Arc<Access>,
    lexical: LexicalClient,
}

impl<Access> MessageAnnouncer<Access> {
    /// Compose the common message service, authorization service, and Markdown composer.
    pub fn new(
        messages: Arc<dyn MessageCommands>,
        access: Arc<Access>,
        lexical: LexicalClient,
    ) -> Self {
        Self {
            messages,
            access,
            lexical,
        }
    }
}

impl<Access: EntityAccessService> MessageAnnouncer<Access> {
    /// The bot's capability to write into `parent`, minted on the invoking
    /// user's current one: an author who may no longer write there gets
    /// nothing posted or patched in their name.
    async fn bot_write(
        &self,
        bot_id: BotId,
        user: MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>> {
        self.access
            .generate_bot_entity_access_receipt::<MessageWrite>(
                bot_id,
                BotAccessScope::user(user),
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))
    }
}

impl<Access> MessageAnnouncer<Access> {
    /// A chat agent's reply saying `body`, composed by Lexical.
    async fn compose_reply(
        &self,
        session_id: AgentSessionId,
        body: AgentChatReplyBody,
    ) -> Result<String> {
        self.lexical
            .compose_agent_chat_reply(&chat_reply(session_id, body))
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))
    }
}

impl<Access: EntityAccessService> SessionAnnouncer for MessageAnnouncer<Access> {
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<AnnouncedMessage> {
        let access = self
            .bot_write(
                announcement.bot_id,
                announcement.triggered_by.clone(),
                &announcement.origin_parent,
            )
            .await?;
        let content = if announcement.shows_session_link() {
            self.lexical
                .compose_agent_announcement(
                    (!announcement.reuse_origin_message)
                        .then(|| announcement_reply_target(&announcement))
                        .as_ref(),
                    &announcement_chip(&announcement),
                )
                .await
        } else {
            self.lexical
                .compose_agent_chat_reply(&chat_reply(
                    announcement.session_id,
                    AgentChatReplyBody::Pending,
                ))
                .await
        }
        .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        if announcement.reuse_origin_message {
            self.messages
                .patch(
                    access,
                    announcement.origin_message_id,
                    MessagePatch {
                        content: Some(content),
                        notification_policy: PatchMessageNotificationPolicy::Default,
                        ..Default::default()
                    },
                )
                .await
                .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
            return Ok(AnnouncedMessage {
                message_id: announcement.origin_message_id,
            });
        }
        let posted = self
            .messages
            .post(
                access,
                PostMessage {
                    id: announcement.reply_message_id,
                    attribution: MessageAttribution::ActingUser,
                    // Neither shape is news yet. The chip is a pointer: the
                    // thread hears about the session when it finishes or
                    // asks, through the lifecycle notifications. The
                    // pending reply notifies when it is resolved into the
                    // answer, as the answer.
                    notification_policy: PostMessageNotificationPolicy::Silent,
                    content,
                    thread_id: announcement
                        .reply_placement
                        .thread_id(announcement.origin_thread_id),
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        Ok(AnnouncedMessage {
            message_id: posted.id,
        })
    }

    async fn resolve(&self, resolution: ResolvedReply) -> Result<()> {
        if resolution.is_coding {
            return Ok(());
        }
        let access = self
            .bot_write(
                resolution.bot_id,
                resolution.triggered_by,
                &resolution.origin_parent,
            )
            .await?;
        let message_id = resolution.message_id;
        let notification_policy = patch_policy(&resolution.outcome);
        let body = if resolution.segments.is_empty() {
            reply_body(resolution.outcome)
        } else {
            segments_body(
                resolution.turn,
                &resolution.segments,
                Some(&resolution.outcome),
                false,
            )
        };
        let carries_answer = matches!(
            body,
            AgentChatReplyBody::Markdown { .. } | AgentChatReplyBody::Segments { .. }
        );
        let patch = |content| MessagePatch {
            notification_policy,
            content: Some(content),
            ..Default::default()
        };
        let content = self.compose_reply(resolution.session_id, body).await?;
        let patched = match self
            .messages
            .patch(access.clone(), message_id, patch(content))
            .await
        {
            // The message service refuses an edit whose mentions the person
            // who asked could not open. Left there, the reply would spin
            // forever; the answer is kept in the session instead.
            Err(MessageError::Forbidden) if carries_answer => {
                tracing::warn!(%message_id, "the thread may not carry this answer; pointing at the session");
                let content = self
                    .compose_reply(
                        resolution.session_id,
                        AgentChatReplyBody::Markdown {
                            markdown: UNSHAREABLE_ANSWER.to_owned(),
                        },
                    )
                    .await?;
                self.messages
                    .patch(access, message_id, patch(content))
                    .await
            }
            patched => patched,
        };
        match patched {
            Ok(_) => Ok(()),
            // A participant deleted the pending reply while the agent ran:
            // they did not want the answer, and there is nowhere to put it.
            Err(MessageError::NotFound) => {
                tracing::info!(%message_id, "pending reply was deleted; dropping the answer");
                Ok(())
            }
            Err(error) => Err(HarnessError::Announce(rootcause::report!(error).into())),
        }
    }

    async fn decline(&self, declined: DeclinedMention) -> Result<()> {
        let access = self
            .bot_write(
                declined.bot_id,
                declined.triggered_by,
                &declined.origin.parent,
            )
            .await?;
        let content = self
            .lexical
            .compose_agent_connection_prompt(&connection_prompt(declined.blocker))
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        if declined.origin.reuse_origin_message {
            self.messages
                .patch(
                    access,
                    declined.origin.message_id,
                    MessagePatch {
                        content: Some(content),
                        notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                        ..Default::default()
                    },
                )
                .await
                .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
            return Ok(());
        }
        self.messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    anchor: None,
                    content,
                    mentions: Vec::new(),
                    thread_id: declined
                        .origin
                        .reply_placement
                        .thread_id(declined.origin.thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    // Unlike a session chip, this is the whole answer: the
                    // person who asked should hear it even if they have
                    // already looked away from the thread.
                    notification_policy: PostMessageNotificationPolicy::Default,
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        Ok(())
    }

    async fn present(&self, presentation: ReplyPresentation) -> Result<()> {
        let access = self
            .bot_write(
                presentation.bot_id,
                presentation.triggered_by.clone(),
                &presentation.parent,
            )
            .await?;
        let body = match (&presentation.outcome, presentation.segments.is_empty()) {
            // Nothing to show but how the turn ended.
            (Some(outcome), true) => reply_body(outcome.clone()),
            (outcome, _) => segments_body(
                presentation.turn,
                &presentation.segments,
                outcome.as_ref(),
                presentation.pending,
            ),
        };
        let content = self
            .lexical
            .compose_agent_chat_reply(&AgentChatReply {
                session_id: presentation.session_id.to_string(),
                body,
                link: Some(presentation.link),
            })
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        let message_id = presentation.message_id;
        // Posted under its allocated id; a message already there under it is
        // the same reply shown before, and is returned instead.
        let shown = self
            .messages
            .post_from_event(
                access.clone(),
                message_id,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    // Only the reply's last message is news. Earlier ones are
                    // posted as the agent works, the way a teammate's
                    // messages arrive while you watch.
                    notification_policy: if presentation.notify {
                        PostMessageNotificationPolicy::Default
                    } else {
                        PostMessageNotificationPolicy::Silent
                    },
                    content: content.clone(),
                    thread_id: presentation.thread_id,
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        // A participant deleted it while the agent ran: they did not want it.
        if shown.deleted_at.is_some() || shown.content == content {
            return Ok(());
        }
        match self
            .messages
            .patch(
                access,
                message_id,
                MessagePatch {
                    content: Some(content),
                    notification_policy: if presentation.notify {
                        PatchMessageNotificationPolicy::NotifyAsPostedMessage
                    } else {
                        PatchMessageNotificationPolicy::Default
                    },
                    ..Default::default()
                },
            )
            .await
        {
            Ok(_) | Err(MessageError::NotFound) => Ok(()),
            Err(error) => Err(HarnessError::Announce(rootcause::report!(error).into())),
        }
    }

    async fn typing(&self, typing: AgentTypingUpdate) -> Result<()> {
        let access = self
            .bot_write(typing.bot_id, typing.triggered_by, &typing.parent)
            .await?;
        self.messages
            .agent_typing(
                access,
                typing.thread_id,
                typing.active,
                AgentTyping {
                    session_id: typing.session_id.as_uuid(),
                    phase: typing_phase(typing.phase),
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))
    }
}
