//! The Slack calls this client makes, with their rate-limit tiers.

use std::time::Duration;

/// A Slack call: a Web API method, or one of the few non-method requests
/// (edge API, file transfer) that share the same instrumentation and errors.
#[derive(
    Clone, Copy, PartialEq, Eq, Hash, Debug, strum::Display, strum::IntoStaticStr, strum::EnumIter,
)]
pub enum SlackMethod {
    /// `auth.test`
    #[strum(serialize = "auth.test")]
    AuthTest,
    /// `auth.signout`
    #[strum(serialize = "auth.signout")]
    AuthSignout,
    /// `client.userBoot`
    #[strum(serialize = "client.userBoot")]
    ClientUserBoot,
    /// `client.counts`
    #[strum(serialize = "client.counts")]
    ClientCounts,
    /// `users.conversations`
    #[strum(serialize = "users.conversations")]
    UsersConversations,
    /// `users.info`
    #[strum(serialize = "users.info")]
    UsersInfo,
    /// `users.profile.get`
    #[strum(serialize = "users.profile.get")]
    UsersProfileGet,
    /// `conversations.info`
    #[strum(serialize = "conversations.info")]
    ConversationsInfo,
    /// `conversations.history`
    #[strum(serialize = "conversations.history")]
    ConversationsHistory,
    /// `conversations.replies`
    #[strum(serialize = "conversations.replies")]
    ConversationsReplies,
    /// `conversations.view`
    #[strum(serialize = "conversations.view")]
    ConversationsView,
    /// `conversations.members`
    #[strum(serialize = "conversations.members")]
    ConversationsMembers,
    /// `conversations.mark`
    #[strum(serialize = "conversations.mark")]
    ConversationsMark,
    /// `subscriptions.thread.mark`
    #[strum(serialize = "subscriptions.thread.mark")]
    SubscriptionsThreadMark,
    /// `chat.postMessage`
    #[strum(serialize = "chat.postMessage")]
    ChatPostMessage,
    /// `chat.update`
    #[strum(serialize = "chat.update")]
    ChatUpdate,
    /// `chat.delete`
    #[strum(serialize = "chat.delete")]
    ChatDelete,
    /// `reactions.add`
    #[strum(serialize = "reactions.add")]
    ReactionsAdd,
    /// `reactions.remove`
    #[strum(serialize = "reactions.remove")]
    ReactionsRemove,
    /// `files.getUploadURLExternal`
    #[strum(serialize = "files.getUploadURLExternal")]
    FilesGetUploadUrlExternal,
    /// `files.completeUploadExternal`
    #[strum(serialize = "files.completeUploadExternal")]
    FilesCompleteUploadExternal,
    /// `files.info`
    #[strum(serialize = "files.info")]
    FilesInfo,
    /// `team.info`
    #[strum(serialize = "team.info")]
    TeamInfo,
    /// `emoji.list`
    #[strum(serialize = "emoji.list")]
    EmojiList,
    /// The edge API's `users/info` cache lookup (Slack Connect users).
    #[strum(serialize = "edgeapi.users.info")]
    EdgeUsersInfo,
    /// Uploading bytes to the URL `files.getUploadURLExternal` returned.
    #[strum(serialize = "files.upload_bytes")]
    FileUploadBytes,
    /// Downloading a file's `url_private`.
    #[strum(serialize = "files.download")]
    FileDownload,
    /// `signup.checkEmail` (login)
    #[strum(serialize = "signup.checkEmail")]
    SignupCheckEmail,
    /// `auth.captcha` (login)
    #[strum(serialize = "auth.captcha")]
    AuthCaptcha,
    /// `signup.confirmEmail` (login)
    #[strum(serialize = "signup.confirmEmail")]
    SignupConfirmEmail,
    /// `signin.confirmCode` (login)
    #[strum(serialize = "signin.confirmCode")]
    SigninConfirmCode,
    /// `signin.findWorkspaces` (login)
    #[strum(serialize = "signin.findWorkspaces")]
    SigninFindWorkspaces,
    /// `auth.loginMagic` (login, two-factor)
    #[strum(serialize = "auth.loginMagic")]
    AuthLoginMagic,
    /// `auth.loginMagicBulk` (login)
    #[strum(serialize = "auth.loginMagicBulk")]
    AuthLoginMagicBulk,
    /// A magic login link or the app's `/auth` page (login).
    #[strum(serialize = "login.page")]
    LoginPage,
}

/// Slack's published rate-limit tiers, per method, per workspace.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RateTier {
    /// 1+ per minute.
    Tier1,
    /// 20+ per minute.
    Tier2,
    /// 50+ per minute.
    Tier3,
    /// 100+ per minute.
    Tier4,
    /// About one per second (`chat.postMessage` and friends).
    PerSecond,
    /// Not paced by the client (file transfers, login).
    Unpaced,
}

impl RateTier {
    /// How many calls the tier allows per minute, or `None` when unpaced.
    pub fn per_minute(self) -> Option<u32> {
        match self {
            Self::Tier1 => Some(1),
            Self::Tier2 => Some(20),
            Self::Tier3 => Some(50),
            Self::Tier4 => Some(100),
            Self::PerSecond => Some(60),
            Self::Unpaced => None,
        }
    }

    /// The steady-state gap between calls.
    pub fn interval(self) -> Option<Duration> {
        self.per_minute()
            .map(|per_minute| Duration::from_secs(60) / per_minute)
    }
}

impl SlackMethod {
    /// The method's name on the wire (`conversations.history`).
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// The tier the client paces this method at.
    pub fn tier(self) -> RateTier {
        match self {
            Self::AuthTest
            | Self::UsersInfo
            | Self::UsersProfileGet
            | Self::ConversationsInfo
            | Self::ConversationsView
            | Self::ClientCounts
            | Self::ReactionsAdd
            | Self::ReactionsRemove
            | Self::FilesInfo
            | Self::EdgeUsersInfo => RateTier::Tier4,
            Self::UsersConversations
            | Self::ConversationsHistory
            | Self::ConversationsReplies
            | Self::ConversationsMembers
            | Self::ConversationsMark
            | Self::SubscriptionsThreadMark
            | Self::ChatUpdate
            | Self::ChatDelete
            | Self::TeamInfo
            | Self::FilesGetUploadUrlExternal
            | Self::FilesCompleteUploadExternal => RateTier::Tier3,
            Self::ClientUserBoot | Self::EmojiList | Self::AuthSignout => RateTier::Tier2,
            Self::ChatPostMessage => RateTier::PerSecond,
            Self::FileUploadBytes
            | Self::FileDownload
            | Self::SignupCheckEmail
            | Self::AuthCaptcha
            | Self::SignupConfirmEmail
            | Self::SigninConfirmCode
            | Self::SigninFindWorkspaces
            | Self::AuthLoginMagic
            | Self::AuthLoginMagicBulk
            | Self::LoginPage => RateTier::Unpaced,
        }
    }
}
