use serde::Deserialize;

use crate::client::SlackClient;
use crate::error::SlackError;
use crate::ids::{ChannelId, MessageTs};
use crate::method::SlackMethod;
use crate::models::{Conversation, Team, User};

/// `client.userBoot`: everything the web client loads at start.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct UserBoot {
    /// The signed-in user.
    #[serde(rename = "self")]
    pub own_user: User,
    /// The workspace.
    pub team: Team,
    /// Channels the user is in (may be partial; page `users.conversations`).
    #[serde(default)]
    pub channels: Vec<BootChannel>,
    /// Open DMs.
    #[serde(default)]
    pub ims: Vec<BootChannel>,
    /// Conversations open in the sidebar.
    #[serde(default)]
    pub is_open: Vec<ChannelId>,
    /// Every workspace of the session (several on Grid).
    #[serde(default)]
    pub workspaces: Vec<Team>,
}

/// A conversation in `client.userBoot`, with its latest message's `ts`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct BootChannel {
    /// The conversation.
    #[serde(flatten)]
    pub conversation: Conversation,
    /// The latest message.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub latest: Option<MessageTs>,
}

/// `client.counts`: unread state for every conversation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ClientCounts {
    /// Channels.
    #[serde(default)]
    pub channels: Vec<ChannelCounts>,
    /// Group DMs.
    #[serde(default)]
    pub mpims: Vec<ChannelCounts>,
    /// DMs.
    #[serde(default)]
    pub ims: Vec<ChannelCounts>,
    /// Threads the user follows.
    pub threads: Option<ThreadCounts>,
}

/// One conversation's unread state.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ChannelCounts {
    /// The conversation.
    pub id: ChannelId,
    /// The user's read cursor.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub last_read: Option<MessageTs>,
    /// The latest message.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub latest: Option<MessageTs>,
    /// Unread messages exist.
    #[serde(default)]
    pub has_unreads: bool,
    /// Unread mentions.
    #[serde(default)]
    pub mention_count: u32,
}

/// Unread state of followed threads.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct ThreadCounts {
    /// Unread replies exist.
    #[serde(default)]
    pub has_unreads: bool,
    /// Unread mentions.
    #[serde(default)]
    pub mention_count: u32,
}

impl SlackClient {
    /// `client.userBoot`, as the web client calls it on a cold start.
    pub async fn user_boot(&self) -> Result<UserBoot, SlackError> {
        let form = vec![
            ("version_all_channels", "false".to_owned()),
            ("omit_channels", "false".to_owned()),
            ("include_min_version_bump_check", "0".to_owned()),
            ("_x_reason", "initial-data".to_owned()),
            ("_x_sonic", "true".to_owned()),
            ("_x_app_name", "client".to_owned()),
        ];
        self.call(SlackMethod::ClientUserBoot, form).await
    }

    /// `client.counts`: unread cursors and mention counts.
    pub async fn counts(&self) -> Result<ClientCounts, SlackError> {
        let form = vec![
            ("thread_counts_by_channel", "true".to_owned()),
            ("org_wide_aware", "true".to_owned()),
            ("include_file_channels", "true".to_owned()),
            (
                "_x_reason",
                "client-counts-api/fetchClientCounts".to_owned(),
            ),
            ("_x_sonic", "true".to_owned()),
        ];
        self.call(SlackMethod::ClientCounts, form).await
    }
}
