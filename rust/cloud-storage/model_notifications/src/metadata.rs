use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
pub use invite_email::{ChannelInviteMetadata, InviteToTeamMetadata};
use macro_user_id::cowlike::CowLike;
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use model_entity::Entity;
use model_entity::EntityType;
pub use notification::domain::models::NotificationTitle;
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtIos,
    apple::{APNSPushNotification, AlertDictionary, Aps, PushNotificationData},
};
use rootcause::Report;
use rootcause::report;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Debug, Clone, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponseMetadata {
    pub summary: String,
    pub message_id: String,
}

/// The normalized lifecycle status for a GitHub pull request notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GithubPrEventStatus {
    /// The pull request is open.
    Open,
    /// The pull request is closed without being merged.
    Closed,
    /// The pull request is closed and merged.
    Merged,
}

/// The GitHub pull request webhook action that triggered the notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GithubPrEventAction {
    /// The pull request was opened.
    Opened,
    /// The pull request was reopened.
    Reopened,
    /// The pull request was closed.
    Closed,
}

/// The maximum number of characters kept by [`GithubPrNotificationCommon::snippet`].
const GITHUB_SNIPPET_MAX_CHARS: usize = 280;

/// Fields shared by every GitHub pull request notification type.
///
/// Embedded with `#[serde(flatten)]` so the wire shape keeps these keys at the
/// top level of the metadata object.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrNotificationCommon {
    /// The source-specific internal foreign entity row id for this pull request.
    pub foreign_entity_id: Uuid,
    /// The external GitHub key, in `owner/repo/pull/number` format.
    pub github_key: String,
    /// The GitHub repository owner or organization.
    pub owner: String,
    /// The GitHub repository name.
    pub repo: String,
    /// The GitHub pull request number.
    pub number: u64,
    /// The public GitHub URL for the pull request.
    pub url: String,
    /// A compact label suitable for display in the UI.
    pub display_name: String,
    /// The GitHub pull request title. Falls back to `display_name` when GitHub has no title.
    pub title: String,
    /// The GitHub login for the sender, when available.
    pub sender_github_login: Option<String>,
    /// The stable GitHub numeric user id for the sender, serialized as a string.
    pub sender_github_user_id: Option<String>,
    /// The GitHub avatar URL for the sender, when available.
    pub sender_github_avatar_url: Option<String>,
}

impl GithubPrNotificationCommon {
    /// Build a required title value, falling back to the display name when GitHub has no title.
    pub fn title_or_display_name(title: Option<String>, display_name: &str) -> String {
        match title {
            Some(title) if !title.trim().is_empty() => title,
            _ => display_name.to_string(),
        }
    }

    /// Trim and truncate free-form GitHub text (comment or review bodies) to a
    /// display-friendly snippet, keeping character boundaries intact.
    pub fn snippet(text: &str) -> String {
        let trimmed = text.trim();
        if trimmed.chars().count() <= GITHUB_SNIPPET_MAX_CHARS {
            return trimmed.to_string();
        }

        let mut snippet: String = trimmed.chars().take(GITHUB_SNIPPET_MAX_CHARS).collect();
        snippet.push('…');
        snippet
    }

    fn actor_name(&self, sender_id: Option<MacroUserIdStr<'_>>) -> Option<String> {
        sender_id
            .map(|sender| sender.email_part().local_part().to_string())
            .or_else(|| self.sender_github_login.clone())
    }

    /// The shared body format: the compact PR label, plus the PR title when it
    /// adds information beyond the label.
    fn format_body(&self) -> String {
        if self.title == self.display_name {
            return self.display_name.clone();
        }

        format!("{}: {}", self.display_name, self.title)
    }

    /// The shared body format with free-form text (a comment or review
    /// snippet) in place of the PR title, when any is present.
    fn format_body_with_text(&self, text: &str) -> String {
        if text.trim().is_empty() {
            return self.format_body();
        }

        format!("{}: {}", self.display_name, text.trim())
    }
}

/// Metadata for a GitHub pull request lifecycle notification.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrStatusChanged {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// The current normalized pull request status.
    pub status: GithubPrEventStatus,
    /// The webhook action that triggered this notification.
    pub action: GithubPrEventAction,
    /// The prior normalized pull request status, when known.
    pub previous_status: Option<GithubPrEventStatus>,
    /// The pull request head branch, when available.
    pub head_branch: Option<String>,
    /// The pull request base branch, when available.
    pub base_branch: Option<String>,
    /// When the pull request was merged, when available.
    pub merged_at: Option<DateTime<Utc>>,
}

impl GithubPrStatusChanged {
    fn action_verb(&self) -> &'static str {
        if self.status == GithubPrEventStatus::Merged {
            return "merged";
        }

        match self.action {
            GithubPrEventAction::Opened => "opened",
            GithubPrEventAction::Reopened => "reopened",
            GithubPrEventAction::Closed => "closed",
        }
    }
}

impl Notification for GithubPrStatusChanged {
    const TYPE_NAME: &'static str = "github_pr_status_changed";
}

impl NotificationTitle for GithubPrStatusChanged {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let verb = self.action_verb();
        let title = match self.common.actor_name(sender_id) {
            Some(actor) => format!("{actor} {verb} a pull request"),
            None => format!("Pull request {verb}"),
        };

        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.common.format_body())
    }
}

/// The normalized result state for a GitHub pull request check-run notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GithubPrCheckRunState {
    /// The check run completed successfully.
    Completed,
    /// The check run completed with a failure-like conclusion.
    Failed,
}

/// Metadata for a notification that a GitHub pull request check run completed.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrCheckRun {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// The GitHub numeric id of the check run.
    pub check_run_github_id: u64,
    /// The display name GitHub reported for the check run.
    pub check_name: String,
    /// The raw GitHub check run status.
    pub check_status: String,
    /// The raw GitHub check run conclusion.
    pub conclusion: String,
    /// The normalized notification state for this check run.
    pub state: GithubPrCheckRunState,
    /// The public GitHub URL for the check run.
    pub check_url: String,
    /// When GitHub marked the check run as complete.
    pub completed_at: DateTime<Utc>,
}

impl GithubPrCheckRun {
    fn state_verb(&self) -> &'static str {
        match self.state {
            GithubPrCheckRunState::Completed => "completed",
            GithubPrCheckRunState::Failed => "failed",
        }
    }

    fn display_check_name(&self) -> &str {
        let check_name = self.check_name.trim();
        if check_name.is_empty() {
            return "Check";
        }

        check_name
    }
}

impl Notification for GithubPrCheckRun {
    const TYPE_NAME: &'static str = "github_pr_check_run";
}

impl NotificationTitle for GithubPrCheckRun {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(format!(
            "{} {} on a pull request",
            self.display_check_name(),
            self.state_verb()
        ))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.common.format_body())
    }
}

/// Metadata for a notification that the user's review was requested on a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReviewRequested {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// The GitHub login of the requested reviewer, when available.
    pub requested_reviewer_github_login: Option<String>,
    /// The stable GitHub numeric user id of the requested reviewer, serialized as a string.
    pub requested_reviewer_github_user_id: Option<String>,
}

impl Notification for GithubReviewRequested {
    const TYPE_NAME: &'static str = "github_review_requested";
}

impl NotificationTitle for GithubReviewRequested {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let title = match self.common.actor_name(sender_id) {
            Some(actor) => format!("{actor} requested your review"),
            None => "Your review was requested".to_string(),
        };

        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.common.format_body())
    }
}

/// The kind of GitHub comment that triggered a [`GithubPrComment`] notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubPrCommentKind {
    /// A top-level conversation comment (GitHub `issue_comment`).
    Issue,
    /// An inline code review comment (GitHub `pull_request_review_comment`).
    ReviewComment,
}

/// Metadata for a notification that a GitHub pull request was commented on.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrComment {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// The kind of comment that was posted.
    pub comment_kind: GithubPrCommentKind,
    /// The GitHub numeric id of the comment, when available.
    pub comment_github_id: Option<u64>,
    /// The public GitHub URL for the comment, when available.
    pub comment_url: Option<String>,
    /// A truncated excerpt of the comment body.
    pub comment_snippet: String,
}

impl Notification for GithubPrComment {
    const TYPE_NAME: &'static str = "github_pr_comment";
}

impl NotificationTitle for GithubPrComment {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let title = match self.common.actor_name(sender_id) {
            Some(actor) => format!("{actor} commented on a pull request"),
            None => "New comment on a pull request".to_string(),
        };

        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.common.format_body_with_text(&self.comment_snippet))
    }
}

/// Where in a GitHub pull request the user was mentioned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubPrMentionLocation {
    /// The pull request description.
    PrBody,
    /// A top-level conversation comment.
    Comment,
    /// A review summary body.
    Review,
    /// An inline code review comment.
    ReviewComment,
}

/// Metadata for a notification that the user was mentioned on a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrMention {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// Where the mention appeared.
    pub location: GithubPrMentionLocation,
    /// The GitHub numeric id of the comment or review containing the mention, when available.
    pub comment_github_id: Option<u64>,
    /// The public GitHub URL for the text containing the mention, when available.
    pub comment_url: Option<String>,
    /// A truncated excerpt of the text containing the mention.
    pub text_snippet: String,
}

impl Notification for GithubPrMention {
    const TYPE_NAME: &'static str = "github_pr_mention";
}

impl NotificationTitle for GithubPrMention {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let title = match self.common.actor_name(sender_id) {
            Some(actor) => format!("{actor} mentioned you on a pull request"),
            None => "You were mentioned on a pull request".to_string(),
        };

        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.common.format_body_with_text(&self.text_snippet))
    }
}

/// The state of a submitted GitHub pull request review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubPrReviewState {
    /// The reviewer approved the pull request.
    Approved,
    /// The reviewer requested changes.
    ChangesRequested,
    /// The reviewer left a comment review without an approval decision.
    Commented,
}

/// Metadata for a notification that a review was submitted on the user's GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrReview {
    /// Fields shared with the other GitHub pull request notifications.
    #[serde(flatten)]
    pub common: GithubPrNotificationCommon,
    /// The GitHub numeric id of the review, when available.
    pub review_github_id: Option<u64>,
    /// The public GitHub URL for the review, when available.
    pub review_url: Option<String>,
    /// The review decision state.
    pub state: GithubPrReviewState,
    /// A truncated excerpt of the review body, when any was written.
    pub review_snippet: Option<String>,
}

impl Notification for GithubPrReview {
    const TYPE_NAME: &'static str = "github_pr_review";
}

impl NotificationTitle for GithubPrReview {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let actor = self.common.actor_name(sender_id);
        let title = match (self.state, actor) {
            (GithubPrReviewState::Approved, Some(actor)) => {
                format!("{actor} approved your pull request")
            }
            (GithubPrReviewState::Approved, None) => "Your pull request was approved".to_string(),
            (GithubPrReviewState::ChangesRequested, Some(actor)) => {
                format!("{actor} requested changes on your pull request")
            }
            (GithubPrReviewState::ChangesRequested, None) => {
                "Changes were requested on your pull request".to_string()
            }
            (GithubPrReviewState::Commented, Some(actor)) => {
                format!("{actor} reviewed your pull request")
            }
            (GithubPrReviewState::Commented, None) => "Your pull request was reviewed".to_string(),
        };

        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self
            .common
            .format_body_with_text(self.review_snippet.as_deref().unwrap_or_default()))
    }
}

#[derive(Debug, Clone, Copy, ToSchema, Doppleganger, Serialize, Deserialize)]
#[dg(backward = models_comms::channel::ChannelType)]
#[serde(rename_all = "camelCase")]
pub enum ChannelType {
    #[serde(alias = "Public", alias = "public")]
    Public,
    #[serde(alias = "Private", alias = "private")]
    Private,
    #[serde(alias = "DirectMessage", alias = "direct_message")]
    DirectMessage,
    #[serde(alias = "Team", alias = "team")]
    Team,
}

impl ChannelType {
    pub fn to_model_comms(self) -> models_comms::channel::ChannelType {
        match self {
            ChannelType::Public => models_comms::channel::ChannelType::Public,
            ChannelType::Private => models_comms::channel::ChannelType::Private,
            ChannelType::DirectMessage => models_comms::channel::ChannelType::DirectMessage,
            ChannelType::Team => models_comms::channel::ChannelType::Team,
        }
    }
}

/// Common metadata for notifications on channels
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommonChannelMetadata {
    // The type of the channel
    #[serde(alias = "channel_type")]
    pub channel_type: ChannelType,
    // the name of the channel
    #[serde(default)]
    #[serde(alias = "channel_name")]
    pub channel_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageSendMetadata {
    /// The user who sent the message, when sent by a user
    #[serde(default)]
    #[serde(alias = "invited_by")]
    #[serde(alias = "invitedBy")]
    #[schema(value_type = Option<String>)]
    pub sender: Option<MacroUserIdStr<'static>>,
    /// Display name for non-user senders such as bots
    #[serde(default)]
    pub sender_display_name: Option<String>,
    /// The content of the message
    #[serde(default)]
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// The message id
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

/// Metadata for when a item is shared with a user
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemSharedMetadata {
    /// List of user IDs that the item is shared with
    #[serde(alias = "user_ids")]
    pub user_ids: Vec<String>,
    /// The type of item being shared
    #[serde(alias = "item_type")]
    pub item_type: EntityType,
    /// The name/title of the shared item (optional)
    #[serde(alias = "item_id")]
    pub item_id: String,
    /// The name/title of the shared item
    #[serde(alias = "item_name")]
    pub item_name: Option<String>,
    #[serde(alias = "shared_by")]
    #[schema(value_type = String)]
    pub shared_by: MacroUserIdStr<'static>,
    /// Permission level granted (read, write, admin, etc.)
    #[serde(alias = "permission_level")]
    pub permission_level: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMentionMetadata {
    /// The message you were mentioned in
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    /// the id of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_id")]
    pub thread_id: Option<String>,
    /// Display name for non-user senders such as bots
    #[serde(default)]
    pub sender_display_name: Option<String>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelReplyMetadata {
    /// The id of the thread that has the reply
    #[serde(alias = "thread_id")]
    pub thread_id: String,
    /// The id of the new message
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// The sender id of the reply, when sent by a user
    #[serde(default)]
    #[serde(alias = "user_id")]
    #[schema(value_type = Option<String>)]
    pub user_id: Option<MacroUserIdStr<'static>>,
    /// Display name for non-user senders such as bots
    #[serde(default)]
    pub sender_display_name: Option<String>,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    /// The user who sent the root message of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_parent_sender_id")]
    #[schema(value_type = Option<String>)]
    pub thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

/// The sub type of a document in a notification.
/// Serializes as `{ "type": "task" }` matching the storage service pattern.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotificationDocumentSubType {
    Task,
    Snippet,
}

/// Someone mentioned a document in a channel
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMentionMetadata {
    /// The name of the document
    #[serde(alias = "document_name")]
    pub document_name: String,
    /// The owner of the document
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document
    #[serde(alias = "file_type")]
    pub file_type: Option<String>,
    /// The sub type of the document (e.g. task)
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    #[serde(flatten)]
    pub channel: ChannelMentionMetadata,
}

impl From<DocumentMentionMetadata> for serde_json::Value {
    fn from(val: DocumentMentionMetadata) -> Self {
        serde_json::to_value(val).unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewEmailMetadata {
    pub sender: Option<String>,
    #[serde(alias = "to_email")]
    pub to_email: String,
    #[serde(alias = "thread_id")]
    pub thread_id: String,
    pub subject: String,
    pub snippet: String,
}

impl notification::domain::models::Notification for NewEmailMetadata {
    const TYPE_NAME: &'static str = "new_email";
}

impl NotificationTitle for NewEmailMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.subject.clone())
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.snippet.clone())
    }
}

impl notification::domain::models::Notification for AiResponseMetadata {
    const TYPE_NAME: &'static str = "ai_response";
}

impl notification::domain::models::Notification for ChannelMessageSendMetadata {
    const TYPE_NAME: &'static str = "channel_message_send";
}

impl notification::domain::models::Notification for ChannelMentionMetadata {
    const TYPE_NAME: &'static str = "channel_mention";
}

impl notification::domain::models::Notification for ChannelReplyMetadata {
    const TYPE_NAME: &'static str = "channel_message_reply";
}

impl notification::domain::models::Notification for DocumentMentionMetadata {
    const TYPE_NAME: &'static str = "document_mention";
}

impl NotificationTitle for ChannelMentionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = sender_id
            .map(|sender| sender.email_part().local_part().to_string())
            .or_else(|| self.sender_display_name.clone())
            .ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        Ok(match self.common.channel_type {
            ChannelType::DirectMessage => {
                format!("{sender} mentioned you")
            }
            _ => format!("{sender} mentioned you in #{}", self.common.channel_name),
        })
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
    }
}

impl NotificationTitle for DocumentMentionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = sender_id
            .map(|sender| sender.0.email_part().email_str().to_string())
            .or_else(|| self.channel.sender_display_name.clone())
            .ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        Ok(format!("{sender} sent a document",))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let file_type_str = self.file_type.as_deref().unwrap_or("");
        Ok(format!("{}.{}", self.document_name, file_type_str))
    }
}

impl NotificationTitle for ChannelMessageSendMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = self
            .sender
            .as_ref()
            .map(|sender| sender.email_part().local_part().to_string())
            .or_else(|| self.sender_display_name.clone())
            .ok_or_else(|| report!("Expected sender to exist for {:?}", &self))?;
        let title = match self.common.channel_type {
            ChannelType::DirectMessage => sender,
            _ => format!("{sender} <{}>", self.common.channel_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
    }
}

impl NotificationTitle for MentionedInDocumentCommentMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} mentioned you in {}.{ft}", self.document_name),
            None => format!("{sender} mentioned you in {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationTitle for ChannelReplyMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender = self
            .user_id
            .as_ref()
            .map(|sender| sender.email_part().local_part().to_string())
            .or_else(|| self.sender_display_name.clone())
            .ok_or_else(|| report!("Expected sender to exist for {:?}", &self))?;
        Ok(format!("Reply from {sender}"))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
    }
}

/// Metadata for when a user is assigned to a task
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignedMetadata {
    /// The unique identifier of the task
    #[serde(alias = "task_id")]
    pub task_id: String,
    /// The name of the task (optional)
    #[serde(alias = "task_name")]
    pub task_name: Option<String>,
    /// The sub type of the backing document (task).
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    /// The user who assigned the task
    #[serde(alias = "assigned_by")]
    #[schema(value_type = String)]
    pub assigned_by: MacroUserIdStr<'static>,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

/// Helper to parse XML message content to plain text, returning None on failure.
fn parse_message_plain_text(content: &str) -> Result<String, Report> {
    let parsed = ParsedXmlText::parse(content)?;
    Ok(PlainTextFormatter::format_xml_text(parsed).0)
}

fn parse_message_plain_text_or_attachment(
    content: &str,
    has_attachments: bool,
) -> Result<String, Report> {
    let mut text = parse_message_plain_text(content)?;
    let attached_items = "[attached items]";
    if has_attachments && text.trim().is_empty() {
        return Ok(attached_items.to_string());
    }
    if has_attachments {
        text.push('\n');
        text.push_str(attached_items);
    }
    Ok(text)
}

/// Helper to create an alert-style APNS notification with title and body.
fn alert_apns<T: NotificationTitle>(
    notif: &T,
    sender_id: Option<MacroUserIdStr<'_>>,
    notification_id: Uuid,
    sender_profile_picture_url: Option<String>,
) -> Result<APNSPushNotification<PushNotificationData>, Report> {
    let title = notif.format_title(sender_id.as_ref().map(CowLike::copied))?;
    let body = notif.format_body(sender_id)?;

    let mutable_content = if sender_profile_picture_url.is_some() {
        Some(1)
    } else {
        None
    };
    Ok(APNSPushNotification {
        aps: Aps {
            alert: Some(notification::domain::models::apple::Alert::Dictionary(
                AlertDictionary {
                    title: Some(title),
                    body: Some(body),
                    ..Default::default()
                },
            )),
            mutable_content,
            ..Default::default()
        },
        push_notification_data: PushNotificationData {
            notification_id,
            sender_profile_picture_url,
        },
    })
}

impl NotificationTitle for AiResponseMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok("AI Response".to_string())
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.summary.clone())
    }
}

impl NotificationExtIos for AiResponseMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(self, sender_id, notification_id, None).ok()
    }
}

impl NotificationExtIos for ChannelMessageSendMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for ChannelMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for ChannelReplyMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for DocumentMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.channel.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.channel.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl notification::domain::models::Notification for TaskAssignedMetadata {
    const TYPE_NAME: &'static str = "task_assigned";
}

impl NotificationTitle for TaskAssignedMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let email = self.assigned_by.email_part();
        let sender = email.email_str();
        Ok(format!("Task assigned by {sender}"))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let body = if let Some(ref task_name) = self.task_name {
            format!("assigned you to {}", task_name)
        } else {
            "New Task".to_string()
        };
        Ok(body)
    }
}

impl NotificationExtIos for TaskAssignedMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

/// Notification sent when a user is mentioned in a document comment.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MentionedInDocumentCommentMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// The sub type of the document (e.g. task).
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    /// The mention ID.
    pub mention_id: String,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for MentionedInDocumentCommentMetadata {
    const TYPE_NAME: &'static str = "mentioned_in_document_comment";
}

impl NotificationExtIos for MentionedInDocumentCommentMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

/// Notification sent when someone replies to a document comment thread.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepliedToDocumentCommentThreadMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// The sub type of the document (e.g. task).
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for RepliedToDocumentCommentThreadMetadata {
    const TYPE_NAME: &'static str = "replied_to_document_comment_thread";
}

impl NotificationTitle for RepliedToDocumentCommentThreadMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} replied in {}.{ft}", self.document_name),
            None => format!("{sender} replied in {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for RepliedToDocumentCommentThreadMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

/// Notification sent when someone comments on a document the user owns.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentedOnDocumentMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// The sub type of the document (e.g. task).
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for CommentedOnDocumentMetadata {
    const TYPE_NAME: &'static str = "commented_on_document";
}

impl NotificationTitle for CommentedOnDocumentMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} commented on {}.{ft}", self.document_name),
            None => format!("{sender} commented on {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for CommentedOnDocumentMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}
