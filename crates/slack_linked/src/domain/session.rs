//! In-process API for the Slack session service. The replica that holds an
//! account's advisory lock calls these with the [`SessionScope`] it received
//! from [`SessionService::begin_lease`]; every write is fenced by that epoch,
//! and a `Fenced` error means the replica must stop the account at once.
//!
//! Also the mapping from Slack's shapes (`slack_client::models`, websocket
//! events) to what Macro stores, so it is tested without a Slack.

use super::{events::*, models::*, ports::SessionRepository};
use chrono::{DateTime, Utc};
use external_chat::domain::{
    models::ExternalChatKind,
    ports::ExternalChatResult,
    rich::{SystemAction, SystemLine},
};
use slack_client::{
    SlackErrorCode,
    models::{Conversation, ConversationKind, Message, MessageSubtype},
    realtime::{ReactionItem, SlackEvent},
};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Largest inbound text Macro stores, in UTF-8 bytes.
const INBOUND_TEXT_LIMIT_BYTES: usize = 64 * 1024;

/// Session-service use cases.
#[derive(Clone)]
pub struct SessionService {
    repository: Arc<dyn SessionRepository>,
}

impl SessionService {
    /// Wire the repository at the session service's composition root.
    pub fn new(repository: Arc<dyn SessionRepository>) -> Self {
        Self { repository }
    }

    /// Accounts that need a replica and whose lock nobody holds.
    pub async fn discoverable_accounts(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        self.repository.discoverable_accounts(limit).await
    }

    /// Accounts nobody runs, and the age in seconds of the oldest queued
    /// change.
    pub async fn fleet_health(&self) -> ExternalChatResult<(u64, u64)> {
        self.repository.fleet_health().await
    }

    /// Take over an account after acquiring its advisory lock.
    #[tracing::instrument(name = "slack.session.begin_lease", skip_all, err, fields(account_id = %account, lease_epoch))]
    pub async fn begin_lease(&self, account: Uuid) -> ExternalChatResult<Lease> {
        let lease = self.repository.begin_lease(account).await?;
        tracing::Span::current().record("lease_epoch", lease.scope.lease_epoch);
        if lease.sends_marked_unknown > 0 {
            tracing::warn!(
                count = lease.sends_marked_unknown,
                "sends left in flight by the previous replica are unknown"
            );
        }
        Ok(lease)
    }

    /// Hand the account over before unlocking.
    #[tracing::instrument(name = "slack.session.release_lease", skip_all, err, fields(account_id = %scope.account_id, lease_epoch = scope.lease_epoch))]
    pub async fn release_lease(&self, scope: SessionScope) -> ExternalChatResult<()> {
        self.repository.release_lease(scope).await
    }

    /// Tell other replicas an unlocked account still needs a session.
    pub async fn announce_released(&self, account: Uuid) -> ExternalChatResult<()> {
        self.repository.announce_released(account).await
    }

    /// The session booted.
    #[tracing::instrument(name = "slack.session.connected", skip_all, err, fields(account_id = %scope.account_id))]
    pub async fn connected(
        &self,
        scope: SessionScope,
        facts: &BootFacts,
    ) -> ExternalChatResult<()> {
        self.repository.connected(scope, facts).await
    }

    /// Slack ended the session.
    #[tracing::instrument(name = "slack.session.ended", skip_all, err, fields(account_id = %scope.account_id, reason = <&'static str>::from(reason)))]
    pub async fn session_ended(
        &self,
        scope: SessionScope,
        reason: EndedReason,
    ) -> ExternalChatResult<()> {
        self.repository.session_ended(scope, reason).await
    }

    /// A requested sign-out ran.
    pub async fn signed_out(&self, scope: SessionScope) -> ExternalChatResult<()> {
        self.repository.signed_out(scope).await
    }

    /// Replace the account's Slack Connect catalogue.
    #[tracing::instrument(name = "slack.session.catalogue", skip_all, err, fields(account_id = %scope.account_id, conversations = catalogue.conversations.len()))]
    pub async fn replace_catalogue(
        &self,
        scope: SessionScope,
        catalogue: &Catalogue,
    ) -> ExternalChatResult<()> {
        self.repository.replace_catalogue(scope, catalogue).await
    }

    /// The account's lifecycle state and consent generation.
    pub async fn consent(&self, scope: SessionScope) -> ExternalChatResult<(AccountState, i64)> {
        self.repository.consent(scope).await
    }

    /// The added chats the account observes.
    pub async fn observed_chats(
        &self,
        scope: SessionScope,
    ) -> ExternalChatResult<Vec<ObservedChat>> {
        self.repository.observed_chats(scope).await
    }

    /// Persist a change before it is ingested.
    pub async fn enqueue_inbound(
        &self,
        scope: SessionScope,
        change: &InboundChange,
    ) -> ExternalChatResult<Uuid> {
        self.repository.enqueue_inbound(scope, change).await
    }

    /// Ingest every queued change of the account, oldest first; returns how
    /// many were applied. Deferred changes stay queued.
    #[tracing::instrument(name = "slack.session.ingest_queued", skip_all, err, fields(account_id = %scope.account_id, applied, deferred))]
    pub async fn ingest_queued(&self, scope: SessionScope) -> ExternalChatResult<usize> {
        let queued = self.repository.queued_inbound(scope, 500).await?;
        let (mut applied, mut deferred) = (0, 0);
        for item in queued {
            match self.repository.ingest(scope, item.id, &item.change).await? {
                Ingested::Applied => applied += 1,
                Ingested::Deferred => deferred += 1,
                Ingested::Ignored => {}
            }
        }
        let span = tracing::Span::current();
        span.record("applied", applied);
        span.record("deferred", deferred);
        Ok(applied)
    }

    /// Claim pending file downloads.
    pub async fn claim_media(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<MediaImport>> {
        self.repository.claim_media(scope, limit).await
    }

    /// Stage a downloaded file.
    #[tracing::instrument(name = "slack.media.complete", skip_all, err, fields(chat_id = %attachment.chat_id, bytes = bytes.len()))]
    pub async fn complete_media(
        &self,
        scope: SessionScope,
        attachment: &external_chat::domain::models::AttachmentRef,
        bytes: &[u8],
    ) -> ExternalChatResult<()> {
        self.repository
            .complete_media(scope, attachment, bytes)
            .await
    }

    /// A download failed.
    pub async fn fail_media(
        &self,
        scope: SessionScope,
        attachment: &external_chat::domain::models::AttachmentRef,
        failure: MediaFailure,
    ) -> ExternalChatResult<()> {
        self.repository.fail_media(scope, attachment, failure).await
    }

    /// Claim pending sends.
    pub async fn claim_sends(
        &self,
        scope: SessionScope,
        limit: i64,
    ) -> ExternalChatResult<Vec<ClaimedSend>> {
        self.repository.claim_sends(scope, limit).await
    }

    /// The staged file of a claimed file send.
    pub async fn outbound_file(
        &self,
        scope: SessionScope,
        send: Uuid,
    ) -> ExternalChatResult<OutboundFile> {
        self.repository.outbound_file(scope, send).await
    }

    /// The point of no return for one send.
    pub async fn begin_dispatch(
        &self,
        scope: SessionScope,
        send: Uuid,
        client_msg_id: &str,
    ) -> ExternalChatResult<bool> {
        self.repository
            .begin_dispatch(scope, send, client_msg_id)
            .await
    }

    /// Record how a send ended.
    #[tracing::instrument(name = "slack.session.send_outcome", skip_all, err, fields(account_id = %scope.account_id, send_id = %send))]
    pub async fn record_send_outcome(
        &self,
        scope: SessionScope,
        send: Uuid,
        outcome: &SendOutcome,
    ) -> ExternalChatResult<()> {
        self.repository
            .record_send_outcome(scope, send, outcome)
            .await
    }

    /// Read marks to send to Slack.
    pub async fn pending_read_marks(
        &self,
        scope: SessionScope,
    ) -> ExternalChatResult<Vec<ReadMark>> {
        self.repository.pending_read_marks(scope).await
    }

    /// A read mark went to Slack.
    pub async fn read_mark_done(
        &self,
        scope: SessionScope,
        mark: &ReadMark,
    ) -> ExternalChatResult<()> {
        self.repository.read_mark_done(scope, mark).await
    }

    /// History imports to run.
    pub async fn history_work(&self, scope: SessionScope) -> ExternalChatResult<Vec<HistoryWork>> {
        self.repository.history_work(scope).await
    }

    /// A history page was stored.
    pub async fn history_page(
        &self,
        scope: SessionScope,
        chat: Uuid,
        oldest_ts: Option<&str>,
        imported: i32,
        exhausted: bool,
    ) -> ExternalChatResult<()> {
        self.repository
            .history_page(scope, chat, oldest_ts, imported, exhausted)
            .await
    }

    /// Claim a sign-in attempt with input.
    pub async fn claim_login(&self, attempt: Uuid) -> ExternalChatResult<Option<LoginWork>> {
        self.repository.claim_login(attempt).await
    }

    /// Attempts whose signal was missed.
    pub async fn waiting_logins(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>> {
        self.repository.waiting_logins(limit).await
    }

    /// The teams the person has an active account for.
    pub async fn connected_teams(&self, user_id: &str) -> ExternalChatResult<Vec<String>> {
        self.repository.connected_teams(user_id).await
    }

    /// The account id to seal a workspace's credentials for.
    pub async fn account_id_for(&self, user_id: &str, team_id: &str) -> ExternalChatResult<Uuid> {
        self.repository.account_id_for(user_id, team_id).await
    }

    /// Move a claimed sign-in on.
    #[tracing::instrument(name = "slack.session.login_advance", skip_all, err, fields(login_id = %attempt))]
    pub async fn advance_login(
        &self,
        attempt: Uuid,
        advance: &LoginAdvance,
    ) -> ExternalChatResult<()> {
        self.repository.advance_login(attempt, advance).await
    }
}

/// Why Slack ended a session, when an error code means it did.
pub fn ended_reason(code: &SlackErrorCode) -> Option<EndedReason> {
    match code {
        SlackErrorCode::InvalidAuth | SlackErrorCode::NotAuthed | SlackErrorCode::TokenRevoked => {
            Some(EndedReason::Revoked)
        }
        SlackErrorCode::TokenExpired => Some(EndedReason::Expired),
        SlackErrorCode::AccountInactive => Some(EndedReason::AccountInactive),
        SlackErrorCode::TeamDisabled => Some(EndedReason::TeamDisabled),
        SlackErrorCode::UserRemovedFromTeam => Some(EndedReason::RemovedFromTeam),
        SlackErrorCode::EnterpriseIsRestricted => Some(EndedReason::EnterpriseRestricted),
        _ => None,
    }
}

/// A catalogue row for a Slack Connect conversation; `None` for anything
/// else (internal channels and DMs are never listed). `own_team` is the
/// account's workspace, `user_team` names a DM's other person's team.
pub fn catalogue_conversation(
    conversation: &Conversation,
    own_team: &str,
    user_team: impl Fn(&str) -> Option<String>,
) -> Option<CatalogueConversation> {
    let kind = conversation.kind();
    let direct_user_id = conversation.user.as_ref().map(|user| user.to_string());
    let external_dm = match kind {
        ConversationKind::DirectMessage => direct_user_id
            .as_deref()
            .and_then(&user_team)
            .is_some_and(|team| team != own_team),
        ConversationKind::PublicChannel
        | ConversationKind::PrivateChannel
        | ConversationKind::GroupDirectMessage => false,
    };
    if !conversation.is_slack_connect() && !conversation.is_pending_ext_shared && !external_dm {
        return None;
    }
    let mut connected_team_ids: Vec<String> = conversation
        .connected_team_ids
        .iter()
        .chain(&conversation.shared_team_ids)
        .map(|team| team.to_string())
        .filter(|team| team != own_team)
        .collect();
    if external_dm && let Some(team) = direct_user_id.as_deref().and_then(&user_team) {
        connected_team_ids.push(team);
    }
    connected_team_ids.sort();
    connected_team_ids.dedup();
    Some(CatalogueConversation {
        conversation_id: conversation.id.to_string(),
        kind: match kind {
            ConversationKind::DirectMessage => ExternalChatKind::Direct,
            ConversationKind::PublicChannel
            | ConversationKind::PrivateChannel
            | ConversationKind::GroupDirectMessage => ExternalChatKind::Group,
        },
        name: conversation.name.clone().unwrap_or_default(),
        topic: conversation
            .topic
            .as_ref()
            .map(|topic| topic.value.clone())
            .filter(|topic| !topic.is_empty()),
        is_private: conversation.is_private,
        is_archived: conversation.is_archived,
        is_member: conversation.is_member || kind == ConversationKind::DirectMessage,
        frozen_reason: conversation.is_frozen.then(|| {
            conversation
                .frozen_reason
                .clone()
                .map(String::from)
                .unwrap_or_else(|| "frozen".to_owned())
        }),
        connected_team_ids,
        direct_user_id,
        last_activity_at: conversation
            .updated
            .and_then(DateTime::<Utc>::from_timestamp_millis),
        unread_count: conversation.unread_count.unwrap_or(0),
        last_read_ts: conversation.last_read.as_ref().map(|ts| ts.to_string()),
    })
}

/// The emoji Macro stores for a Slack reaction name: Unicode when Slack's
/// name has one, else `:name:` (a workspace's custom emoji).
pub fn reaction_emoji(name: &str) -> String {
    slack_client::emoji::unicode(name)
        .map(str::to_owned)
        .unwrap_or_else(|| format!(":{}:", name.trim_matches(':')))
}

/// The Slack reaction name for an emoji Macro stored; `None` for an emoji
/// Slack has no name for.
pub fn reaction_name(emoji: &str) -> Option<String> {
    if let Some(name) = slack_client::emoji::name(emoji) {
        return Some(name.to_owned());
    }
    emoji
        .strip_prefix(':')
        .and_then(|inner| inner.strip_suffix(':'))
        .filter(|inner| !inner.is_empty() && !inner.contains(':'))
        .map(str::to_owned)
}

/// The changes a websocket event brings to added conversations; most events
/// bring none.
pub fn inbound_changes(event: &SlackEvent) -> Vec<InboundChange> {
    match event {
        SlackEvent::Message(event) => {
            let conversation_id = event.channel.to_string();
            match &event.message.subtype {
                Some(MessageSubtype::MessageChanged) => event
                    .changed_message
                    .as_deref()
                    .filter(|message| message.edited.is_some())
                    .map(|message| InboundChange::Edited {
                        conversation_id,
                        message: inbound_message(message),
                    })
                    .into_iter()
                    .collect(),
                Some(MessageSubtype::MessageDeleted) => event
                    .deleted_ts
                    .as_ref()
                    .map(|ts| InboundChange::Deleted {
                        conversation_id,
                        ts: ts.to_string(),
                        at: ts_time(event.message.ts.as_str()),
                    })
                    .into_iter()
                    .collect(),
                // Only re-states the root's reply count.
                Some(MessageSubtype::MessageReplied) => vec![],
                _ => vec![InboundChange::Message {
                    conversation_id,
                    message: inbound_message(&event.message),
                    origin: IngestOrigin::Live,
                }],
            }
        }
        SlackEvent::ReactionAdded(reaction) | SlackEvent::ReactionRemoved(reaction) => {
            let ReactionItem::Message { channel, ts } = &reaction.item else {
                return vec![];
            };
            vec![InboundChange::Reaction {
                conversation_id: channel.to_string(),
                ts: ts.to_string(),
                slack_user_id: reaction.user.to_string(),
                emoji: reaction_emoji(&reaction.reaction),
                added: matches!(event, SlackEvent::ReactionAdded(_)),
                event_ts: reaction
                    .event_ts
                    .as_ref()
                    .map(|ts| ts.to_string())
                    .unwrap_or_else(|| ts.to_string()),
            }]
        }
        SlackEvent::ChannelMarked(marked)
        | SlackEvent::ImMarked(marked)
        | SlackEvent::GroupMarked(marked)
        | SlackEvent::MpimMarked(marked) => vec![InboundChange::Marked {
            conversation_id: marked.channel.to_string(),
            thread_ts: None,
            ts: marked.ts.to_string(),
        }],
        SlackEvent::ThreadMarked(marked) => vec![InboundChange::Marked {
            conversation_id: marked.subscription.channel.to_string(),
            thread_ts: Some(marked.subscription.thread_ts.to_string()),
            ts: marked.subscription.last_read.to_string(),
        }],
        SlackEvent::ChannelIdChanged(changed) => vec![InboundChange::ConversationIdChanged {
            old_id: changed.old_channel_id.to_string(),
            new_id: changed.new_channel_id.to_string(),
        }],
        _ => vec![],
    }
}

/// Whether an event changes the catalogue, so the replica refreshes it.
pub fn changes_catalogue(event: &SlackEvent) -> bool {
    matches!(
        event,
        SlackEvent::ChannelJoined(_)
            | SlackEvent::GroupJoined(_)
            | SlackEvent::ChannelLeft(_)
            | SlackEvent::GroupLeft(_)
            | SlackEvent::ChannelRename(_)
            | SlackEvent::GroupRename(_)
            | SlackEvent::ChannelIdChanged(_)
            | SlackEvent::ChannelArchive(_)
            | SlackEvent::ChannelUnarchive(_)
            | SlackEvent::ChannelDeleted(_)
            | SlackEvent::GroupArchive(_)
            | SlackEvent::ChannelShared(_)
            | SlackEvent::ChannelUnshared(_)
            | SlackEvent::SharedChannelInviteAccepted(_)
            | SlackEvent::SharedChannelInviteApproved(_)
            | SlackEvent::ImCreated(_)
            | SlackEvent::ImOpen(_)
    )
}

/// One Slack message as Macro stores it.
pub fn inbound_message(message: &Message) -> InboundMessage {
    let sender = match (&message.user, &message.bot_id) {
        (Some(user), _) => Sender::User {
            slack_user_id: user.to_string(),
            team_id: message
                .user_team
                .as_ref()
                .or(message.team.as_ref())
                .map(|team| team.to_string()),
            display_name: message
                .user_profile
                .as_ref()
                .map(|profile| {
                    if profile.display_name.is_empty() {
                        profile.real_name.clone()
                    } else {
                        profile.display_name.clone()
                    }
                })
                .filter(|name| !name.is_empty()),
        },
        (None, Some(bot)) => Sender::Bot {
            bot_id: bot.to_string(),
            display_name: message
                .username
                .clone()
                .or_else(|| message.bot_profile.as_ref().map(|bot| bot.name.clone())),
        },
        (None, None) => Sender::Conversation,
    };
    let mut body = if message.text.trim().is_empty() {
        super::blocks::blocks_to_mrkdwn(&message.blocks)
    } else {
        message.text.clone()
    };
    truncate_to_char_boundary(&mut body, INBOUND_TEXT_LIMIT_BYTES);
    InboundMessage {
        ts: message.ts.to_string(),
        sent_at: ts_time(message.ts.as_str()),
        sender,
        mentions: mentions(&body),
        body,
        thread_ts: message
            .is_thread_reply()
            .then(|| message.thread_ts.as_ref().map(|ts| ts.to_string()))
            .flatten(),
        broadcast: message.subtype == Some(MessageSubtype::ThreadBroadcast),
        system: system_line(message),
        files: message
            .files
            .iter()
            .map(|file| InboundFile {
                file_id: file.id.to_string(),
                filename: file
                    .name
                    .clone()
                    .or_else(|| file.title.clone())
                    .unwrap_or_else(|| file.id.to_string()),
                mime: file.mimetype.clone(),
                size: file.size,
                width: file.original_w,
                height: file.original_h,
                duration_seconds: file
                    .duration_ms
                    .map(|millis| u32::try_from(millis / 1000).unwrap_or(u32::MAX)),
            })
            .collect(),
        edited_ts: message.edited.as_ref().map(|edited| edited.ts.to_string()),
        client_msg_id: message.client_msg_id.clone(),
    }
}

/// Slack user ids the mrkdwn mentions (`<@U…>` or `<@U…|name>`), in order,
/// without repeats.
pub fn mentions(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for captures in lazy_regex::regex!(r"<@([UW][A-Z0-9]+)(?:\|[^>]*)?>").captures_iter(text) {
        let (_, [id]) = captures.extract();
        if !found.iter().any(|seen: &String| seen == id) {
            found.push(id.to_owned());
        }
    }
    found
}

/// The system line for Slack's housekeeping messages that Macro draws as
/// lines; other housekeeping (archived, huddles, reminders) stays text.
fn system_line(message: &Message) -> Option<SystemLine> {
    let user = || message.user.iter().map(ToString::to_string).collect();
    let (action, participants, value) = match message.subtype.as_ref()? {
        MessageSubtype::ChannelJoin | MessageSubtype::GroupJoin => {
            (SystemAction::ParticipantsJoined, user(), None)
        }
        MessageSubtype::ChannelLeave | MessageSubtype::GroupLeave => {
            (SystemAction::ParticipantsLeft, user(), None)
        }
        MessageSubtype::ChannelTopic | MessageSubtype::GroupTopic => (
            SystemAction::DescriptionChanged,
            vec![],
            message.topic.clone(),
        ),
        MessageSubtype::ChannelPurpose | MessageSubtype::GroupPurpose => (
            SystemAction::DescriptionChanged,
            vec![],
            message.purpose.clone(),
        ),
        MessageSubtype::ChannelName | MessageSubtype::GroupName => {
            (SystemAction::SubjectChanged, vec![], message.name.clone())
        }
        MessageSubtype::PinnedItem => (SystemAction::MessagePinned, vec![], None),
        MessageSubtype::UnpinnedItem => (SystemAction::MessageUnpinned, vec![], None),
        MessageSubtype::ChannelArchive
        | MessageSubtype::ChannelUnarchive
        | MessageSubtype::ChannelConvertToPrivate
        | MessageSubtype::HuddleThread
        | MessageSubtype::ReminderAdd
        | MessageSubtype::BotMessage
        | MessageSubtype::MeMessage
        | MessageSubtype::MessageChanged
        | MessageSubtype::MessageDeleted
        | MessageSubtype::MessageReplied
        | MessageSubtype::ThreadBroadcast
        | MessageSubtype::FileShare
        | MessageSubtype::Tombstone
        | MessageSubtype::EkmAccessDenied
        | MessageSubtype::SlackbotResponse
        | MessageSubtype::Other(_) => return None,
    };
    Some(SystemLine {
        action,
        participants,
        value: value.filter(|value| !value.is_empty()),
        call: None,
        by_provider: false,
    })
}

/// The wall-clock time of a Slack `ts`; the epoch when it is malformed.
pub fn ts_time(ts: &str) -> DateTime<Utc> {
    slack_client::MessageTs::new(ts)
        .ok()
        .and_then(|ts| ts.to_datetime())
        .unwrap_or(DateTime::UNIX_EPOCH)
}

fn truncate_to_char_boundary(text: &mut String, limit: usize) {
    if text.len() > limit {
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
}
