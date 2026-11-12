//! What the session service hands the domain, and what it gets back. Slack's
//! own shapes come from `slack_client::models`; these are what Macro stores.

use super::models::*;
use chrono::{DateTime, Utc};
use external_chat::domain::models::ExternalChatKind;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The replica's fence for every call on an account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionScope {
    /// The account.
    pub account_id: Uuid,
    /// Epoch of the replica's lease; a newer lease fences this one.
    pub lease_epoch: i64,
}

/// A sealed blob and its wrapped data key, as stored.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSecret {
    /// `kms_envelope` blob.
    pub ciphertext: Vec<u8>,
    /// Wrapped data key.
    pub data_key: Vec<u8>,
    /// KMS key that wrapped it.
    pub kms_key_id: String,
    /// Sealing scheme.
    pub encryption_version: i16,
}

impl std::fmt::Debug for StoredSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredSecret")
            .field("kms_key_id", &self.kms_key_id)
            .finish_non_exhaustive()
    }
}

/// Account facts a replica needs after taking the lease.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    /// Fence for later calls.
    pub scope: SessionScope,
    /// Account owner.
    pub user_id: String,
    /// The workspace.
    pub team_id: String,
    /// Its subdomain, for the API host.
    pub team_domain: String,
    /// The person's Slack user id, once booted.
    pub slack_user_id: Option<String>,
    /// Lifecycle.
    pub state: AccountState,
    /// Consent generation.
    pub generation: i64,
    /// The sealed credentials; `None` once consent ended.
    pub credentials: Option<StoredSecret>,
    /// The owner asked to sign out of Slack when disconnecting.
    pub sign_out_requested: bool,
    /// Sends left in flight by an earlier replica, now `unknown`.
    pub sends_marked_unknown: u64,
}

/// What `client.userBoot` told us about the session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootFacts {
    /// The person's Slack user id.
    pub slack_user_id: String,
    /// Their display name.
    pub display_name: Option<String>,
    /// Workspace name.
    pub team_name: String,
    /// Workspace subdomain.
    pub team_domain: String,
    /// Workspace icon.
    pub team_icon_url: Option<String>,
    /// Enterprise Grid org.
    pub enterprise_id: Option<String>,
}

/// One Slack Connect conversation as the session service read it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogueConversation {
    /// Conversation id.
    pub conversation_id: String,
    /// Channel or DM.
    pub kind: ExternalChatKind,
    /// Name without `#`; a DM's is empty.
    pub name: String,
    /// Topic.
    pub topic: Option<String>,
    /// Private channel.
    pub is_private: bool,
    /// Archived.
    pub is_archived: bool,
    /// The person is in it.
    pub is_member: bool,
    /// Slack's frozen reason.
    pub frozen_reason: Option<String>,
    /// The other organizations.
    pub connected_team_ids: Vec<String>,
    /// A DM's other person.
    pub direct_user_id: Option<String>,
    /// Newest activity.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Unread messages.
    pub unread_count: u32,
    /// Slack's read position.
    pub last_read_ts: Option<String>,
}

/// A Slack user as Slack described them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserFacts {
    /// Id.
    pub slack_user_id: String,
    /// Their organization.
    pub team_id: Option<String>,
    /// Display name.
    pub display_name: Option<String>,
    /// Real name.
    pub real_name: Option<String>,
    /// Avatar.
    pub avatar_url: Option<String>,
    /// A bot user.
    pub is_bot: bool,
    /// Deactivated.
    pub deleted: bool,
}

/// What the catalogue refresh read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Catalogue {
    /// Every Slack Connect conversation of the account.
    pub conversations: Vec<CatalogueConversation>,
    /// Teams named by them.
    pub teams: Vec<Team>,
    /// People named by them.
    pub users: Vec<UserFacts>,
}

/// An added chat the account observes, with where catch-up resumes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedChat {
    /// The external chat.
    pub chat_id: Uuid,
    /// Its Slack conversation.
    pub conversation_id: String,
    /// The newest message ingested.
    pub latest_ts: Option<String>,
}

/// Who wrote a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Sender {
    /// A Slack user (`U…`/`W…`), possibly from another organization.
    User {
        /// Their id.
        slack_user_id: String,
        /// Their organization.
        team_id: Option<String>,
        /// The name the message carried.
        display_name: Option<String>,
    },
    /// A bot or app without a user.
    Bot {
        /// The bot id (`B…`).
        bot_id: String,
        /// The name it posted as.
        display_name: Option<String>,
    },
    /// The conversation itself (a system line Slack names nobody for).
    Conversation,
}

/// Where a message came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IngestOrigin {
    /// The websocket or catch-up after a reconnect.
    Live,
    /// The history import.
    History,
}

/// A Slack file attached to a message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboundFile {
    /// Slack's file id; the replica downloads it with `files.info` and the
    /// session.
    pub file_id: String,
    /// Display filename.
    pub filename: String,
    /// MIME type, when Slack gave one.
    pub mime: Option<String>,
    /// Size in bytes.
    pub size: Option<u64>,
    /// Pixel size.
    pub width: Option<u32>,
    /// Pixel size.
    pub height: Option<u32>,
    /// Length.
    pub duration_seconds: Option<u32>,
}

/// One message as Macro stores it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboundMessage {
    /// Slack's `ts`: the message's id in its conversation.
    pub ts: String,
    /// When it was sent.
    pub sent_at: DateTime<Utc>,
    /// Author.
    pub sender: Sender,
    /// Raw mrkdwn.
    pub body: String,
    /// Slack user ids the text mentions.
    pub mentions: Vec<String>,
    /// The thread root's `ts`, for a reply in a thread.
    pub thread_ts: Option<String>,
    /// A thread reply also sent to the conversation.
    #[serde(default)]
    pub broadcast: bool,
    /// A system line (joined, renamed…).
    pub system: bool,
    /// Files.
    pub files: Vec<InboundFile>,
    /// When it was last edited (`edited.ts`), ordering revisions.
    pub edited_ts: Option<String>,
    /// The id Macro gave a send, echoed back.
    pub client_msg_id: Option<String>,
}

/// A change to an added conversation, ready to store.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InboundChange {
    /// A new message, or one seen again (catch-up, history).
    Message {
        /// The conversation.
        conversation_id: String,
        /// The message.
        message: InboundMessage,
        /// Live or imported.
        origin: IngestOrigin,
    },
    /// An edit: the message as it is now.
    Edited {
        /// The conversation.
        conversation_id: String,
        /// The message.
        message: InboundMessage,
    },
    /// A delete.
    Deleted {
        /// The conversation.
        conversation_id: String,
        /// The deleted message.
        ts: String,
        /// When.
        at: DateTime<Utc>,
    },
    /// A reaction added or removed.
    Reaction {
        /// The conversation.
        conversation_id: String,
        /// The message reacted to.
        ts: String,
        /// Who.
        slack_user_id: String,
        /// Emoji name without colons.
        name: String,
        /// Added (else removed).
        added: bool,
        /// The event's time, ordering add/remove pairs.
        event_ts: String,
    },
    /// The person read up to `ts` elsewhere.
    Marked {
        /// The conversation.
        conversation_id: String,
        /// The thread, for `thread_marked`.
        thread_ts: Option<String>,
        /// Read up to here.
        ts: String,
    },
    /// Slack gave the conversation a new id (a private channel became shared).
    ConversationIdChanged {
        /// Old id.
        old_id: String,
        /// New id.
        new_id: String,
    },
}

impl InboundChange {
    /// The conversation it belongs to.
    pub fn conversation_id(&self) -> &str {
        match self {
            Self::Message {
                conversation_id, ..
            }
            | Self::Edited {
                conversation_id, ..
            }
            | Self::Deleted {
                conversation_id, ..
            }
            | Self::Reaction {
                conversation_id, ..
            }
            | Self::Marked {
                conversation_id, ..
            } => conversation_id,
            Self::ConversationIdChanged { old_id, .. } => old_id,
        }
    }
}

/// A durable inbound row waiting to be ingested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedInbound {
    /// Row id.
    pub id: Uuid,
    /// The change.
    pub change: InboundChange,
}

/// What ingesting a change did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ingested {
    /// Stored or applied.
    Applied,
    /// No added chat of this account wants it.
    Ignored,
    /// Its target is missing; keep it and retry later.
    Deferred,
}

/// A claimed send to dispatch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedSend {
    /// Send id.
    pub id: Uuid,
    /// Chat.
    pub chat_id: Uuid,
    /// Conversation.
    pub conversation_id: String,
    /// What to send (`external_chat`'s `SendReply`, as stored).
    pub payload: serde_json::Value,
    /// For a reply in a thread: the root's `ts`.
    pub thread_ts: Option<String>,
    /// For an edit or delete: the target's `ts`.
    pub target_ts: Option<String>,
    /// The recording request's trace.
    pub traceparent: Option<String>,
}

/// How a dispatched send ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    /// Slack accepted it as this message.
    Accepted {
        /// Its `ts`.
        ts: String,
    },
    /// Slack refused it.
    Failed {
        /// Slack's error code, for the sender.
        code: String,
    },
    /// The replica can't tell; never resent.
    Unknown,
}

/// A read mark to send to Slack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadMark {
    /// The chat.
    pub chat_id: Uuid,
    /// Its conversation.
    pub conversation_id: String,
    /// The thread, or `None` for the conversation.
    pub thread_ts: Option<String>,
    /// Read up to here.
    pub ts: String,
}

/// A history import step to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryWork {
    /// The chat.
    pub chat_id: Uuid,
    /// Its conversation.
    pub conversation_id: String,
    /// The oldest `ts` imported so far; the next page is before it.
    pub before_ts: Option<String>,
    /// Messages imported so far in this run.
    pub imported: i32,
    /// Don't import messages older than this.
    pub not_before: DateTime<Utc>,
}

/// A claimed sign-in attempt and what it waits on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginWork {
    /// Attempt.
    pub id: Uuid,
    /// Owner.
    pub user_id: String,
    /// The step it was in when input arrived (`working` now).
    pub step_data: serde_json::Value,
    /// The input to act on.
    pub input: Option<LoginInput>,
    /// A sealed pasted/captured session.
    pub sealed_input: Option<StoredSecret>,
    /// The replica's private state from the previous step.
    pub sealed_state: Option<StoredSecret>,
    /// The request's trace.
    pub traceparent: Option<String>,
}

/// A workspace session a sign-in produced, sealed for its account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedInWorkspace {
    /// The account id the credentials were sealed for (new, or the person's
    /// existing account for the team).
    pub account_id: Uuid,
    /// Team.
    pub team_id: String,
    /// Enterprise.
    pub enterprise_id: Option<String>,
    /// Team name.
    pub team_name: String,
    /// Team domain.
    pub team_domain: String,
    /// Team icon.
    pub team_icon_url: Option<String>,
    /// The person's Slack user id there.
    pub slack_user_id: String,
    /// The sealed `{token, d, d-s}`.
    pub credentials: StoredSecret,
}

/// Where a sign-in goes next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginAdvance {
    /// Wait for the person in this step, keeping this private state.
    Wait {
        /// The step to show.
        step: LoginStep,
        /// Sealed state for the next step.
        state: Option<StoredSecret>,
    },
    /// Signed in to these workspaces (and skipped those needing SSO).
    Done {
        /// The sessions.
        workspaces: Vec<SignedInWorkspace>,
        /// Chosen workspaces that need SSO.
        skipped: Vec<LoginWorkspace>,
    },
    /// Failed.
    Failed(LoginFailure),
}
