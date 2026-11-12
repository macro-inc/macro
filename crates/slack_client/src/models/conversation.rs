use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::ids::{ChannelId, EnterpriseId, MessageTs, TeamId, UserId};

/// A channel, private channel, DM or group DM, with Slack Connect fields.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Conversation {
    /// The conversation.
    pub id: ChannelId,
    /// Channel name; absent for DMs.
    pub name: Option<String>,
    /// Public or private channel.
    #[serde(default)]
    pub is_channel: bool,
    /// Legacy private channel or group DM.
    #[serde(default)]
    pub is_group: bool,
    /// Direct message.
    #[serde(default)]
    pub is_im: bool,
    /// Group direct message.
    #[serde(default)]
    pub is_mpim: bool,
    /// Private.
    #[serde(default)]
    pub is_private: bool,
    /// Archived.
    #[serde(default)]
    pub is_archived: bool,
    /// The caller is a member.
    #[serde(default)]
    pub is_member: bool,
    /// A DM the caller has open.
    #[serde(default)]
    pub is_open: bool,
    /// Shared with another organization (Slack Connect).
    #[serde(default)]
    pub is_ext_shared: bool,
    /// Shared across workspaces of one Grid org.
    #[serde(default)]
    pub is_org_shared: bool,
    /// Shared at all.
    #[serde(default)]
    pub is_shared: bool,
    /// A Slack Connect invitation is pending.
    #[serde(default)]
    pub is_pending_ext_shared: bool,
    /// Read only after a disconnection; see `frozen_reason`.
    #[serde(default)]
    pub is_frozen: bool,
    /// Why the conversation is frozen.
    pub frozen_reason: Option<FrozenReason>,
    /// The workspace the caller sees it from.
    pub context_team_id: Option<TeamId>,
    /// The hosting workspace or org.
    pub conversation_host_id: Option<TeamId>,
    /// Every workspace the conversation is shared with.
    #[serde(default)]
    pub shared_team_ids: Vec<TeamId>,
    /// External orgs connected to it.
    #[serde(default)]
    pub connected_team_ids: Vec<TeamId>,
    /// Workspaces of the caller's own org it lives in.
    #[serde(default)]
    pub internal_team_ids: Vec<TeamId>,
    /// External orgs invited but not yet connected.
    #[serde(default)]
    pub pending_connected_team_ids: Vec<TeamId>,
    /// The Grid org that owns it.
    pub enterprise_id: Option<EnterpriseId>,
    /// The other person in a DM.
    pub user: Option<UserId>,
    /// Creation time (unix seconds).
    pub created: Option<i64>,
    /// Creator.
    pub creator: Option<UserId>,
    /// The caller's read cursor.
    pub last_read: Option<MessageTs>,
    /// Unread messages (DMs only).
    pub unread_count: Option<u32>,
    /// Topic.
    pub topic: Option<ConversationText>,
    /// Purpose.
    pub purpose: Option<ConversationText>,
    /// Member count.
    pub num_members: Option<u32>,
    /// Earlier names.
    #[serde(default)]
    pub previous_names: Vec<String>,
    /// Last change (unix milliseconds).
    pub updated: Option<i64>,
}

/// What kind of conversation it is, from its flags.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConversationKind {
    /// A public channel.
    PublicChannel,
    /// A private channel.
    PrivateChannel,
    /// A direct message.
    DirectMessage,
    /// A group direct message.
    GroupDirectMessage,
}

impl Conversation {
    /// The conversation's kind.
    pub fn kind(&self) -> ConversationKind {
        if self.is_im {
            ConversationKind::DirectMessage
        } else if self.is_mpim {
            ConversationKind::GroupDirectMessage
        } else if self.is_private || self.is_group {
            ConversationKind::PrivateChannel
        } else {
            ConversationKind::PublicChannel
        }
    }

    /// A Slack Connect conversation: shared with another organization.
    pub fn is_slack_connect(&self) -> bool {
        self.is_ext_shared || !self.connected_team_ids.is_empty()
    }
}

/// A topic or purpose.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct ConversationText {
    /// The text.
    #[serde(default)]
    pub value: String,
    /// Who set it.
    pub creator: Option<UserId>,
    /// When (unix seconds).
    pub last_set: Option<i64>,
}

/// Why a conversation is frozen.
#[derive(Clone, Debug, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr, Serialize, Deserialize)]
#[strum(serialize_all = "snake_case")]
#[serde(from = "String", into = "String")]
pub enum FrozenReason {
    /// The Slack Connect connection was severed; the non-host copy moved to a
    /// new id.
    ConnectionSevered,
    /// Frozen by an admin.
    FrozenByAdmin,
    /// Any other reason, verbatim.
    #[strum(default)]
    Other(String),
}

impl From<String> for FrozenReason {
    fn from(value: String) -> Self {
        Self::from_str(&value).unwrap_or(Self::Other(value))
    }
}

impl From<FrozenReason> for String {
    fn from(value: FrozenReason) -> String {
        match value {
            FrozenReason::Other(reason) => reason,
            known => <&'static str>::from(known).to_owned(),
        }
    }
}
