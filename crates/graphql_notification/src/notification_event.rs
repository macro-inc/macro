//! Typed GraphQL output models for realtime notification event metadata.

use async_graphql::{Enum, ID, Object, Union};
use model_notifications::{
    AiResponseMetadata, CalendarEventReminderMetadata, CallStartedMetadata, ChannelInviteMetadata,
    ChannelMentionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata, ChannelType,
    CommentedOnDocumentMetadata, DocumentMentionMetadata, GithubPrCheckRun, GithubPrCheckRunState,
    GithubPrComment, GithubPrCommentKind, GithubPrEventAction, GithubPrEventStatus,
    GithubPrMention, GithubPrMentionLocation, GithubPrNotificationCommon, GithubPrReview,
    GithubPrReviewState, GithubPrStatusChanged, GithubReviewRequested, InboxReauthRequiredMetadata,
    InviteToTeamMetadata, MentionedInDocumentCommentMetadata, NewEmailMetadata, NotifEvent,
    NotificationDocumentSubType, ReminderMetadata, RepliedToDocumentCommentThreadMetadata,
    TaskAssignedMetadata,
};

/// GraphQL channel type used by notification metadata.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlNotificationChannelType {
    /// Public channel.
    Public,
    /// Private channel.
    Private,
    /// Direct-message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

impl From<ChannelType> for GraphqlNotificationChannelType {
    fn from(value: ChannelType) -> Self {
        match value {
            ChannelType::Public => Self::Public,
            ChannelType::Private => Self::Private,
            ChannelType::DirectMessage => Self::DirectMessage,
            ChannelType::Team => Self::Team,
        }
    }
}

/// GraphQL document subtype used by notification metadata.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlNotificationDocumentSubType {
    /// Task document.
    Task,
    /// Snippet document.
    Snippet,
    /// Skill document.
    Skill,
}

impl From<NotificationDocumentSubType> for GraphqlNotificationDocumentSubType {
    fn from(value: NotificationDocumentSubType) -> Self {
        match value {
            NotificationDocumentSubType::Task => Self::Task,
            NotificationDocumentSubType::Snippet => Self::Snippet,
            NotificationDocumentSubType::Skill => Self::Skill,
        }
    }
}

/// GraphQL GitHub pull-request lifecycle status.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrEventStatus {
    /// Open pull request.
    Open,
    /// Closed pull request.
    Closed,
    /// Merged pull request.
    Merged,
}

impl From<GithubPrEventStatus> for GraphqlGithubPrEventStatus {
    fn from(value: GithubPrEventStatus) -> Self {
        match value {
            GithubPrEventStatus::Open => Self::Open,
            GithubPrEventStatus::Closed => Self::Closed,
            GithubPrEventStatus::Merged => Self::Merged,
        }
    }
}

/// GraphQL GitHub pull-request action.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrEventAction {
    /// Pull request opened.
    Opened,
    /// Pull request reopened.
    Reopened,
    /// Pull request closed.
    Closed,
}

impl From<GithubPrEventAction> for GraphqlGithubPrEventAction {
    fn from(value: GithubPrEventAction) -> Self {
        match value {
            GithubPrEventAction::Opened => Self::Opened,
            GithubPrEventAction::Reopened => Self::Reopened,
            GithubPrEventAction::Closed => Self::Closed,
        }
    }
}

/// GraphQL GitHub check-run state.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrCheckRunState {
    /// Check completed successfully.
    Completed,
    /// Check completed with a failure-like result.
    Failed,
}

impl From<GithubPrCheckRunState> for GraphqlGithubPrCheckRunState {
    fn from(value: GithubPrCheckRunState) -> Self {
        match value {
            GithubPrCheckRunState::Completed => Self::Completed,
            GithubPrCheckRunState::Failed => Self::Failed,
        }
    }
}

/// GraphQL GitHub pull-request comment kind.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrCommentKind {
    /// Top-level issue comment.
    Issue,
    /// Inline review comment.
    ReviewComment,
}

impl From<GithubPrCommentKind> for GraphqlGithubPrCommentKind {
    fn from(value: GithubPrCommentKind) -> Self {
        match value {
            GithubPrCommentKind::Issue => Self::Issue,
            GithubPrCommentKind::ReviewComment => Self::ReviewComment,
        }
    }
}

/// GraphQL location of a GitHub pull-request mention.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrMentionLocation {
    /// Pull-request body.
    PrBody,
    /// Top-level comment.
    Comment,
    /// Review summary.
    Review,
    /// Inline review comment.
    ReviewComment,
}

impl From<GithubPrMentionLocation> for GraphqlGithubPrMentionLocation {
    fn from(value: GithubPrMentionLocation) -> Self {
        match value {
            GithubPrMentionLocation::PrBody => Self::PrBody,
            GithubPrMentionLocation::Comment => Self::Comment,
            GithubPrMentionLocation::Review => Self::Review,
            GithubPrMentionLocation::ReviewComment => Self::ReviewComment,
        }
    }
}

/// GraphQL state of a GitHub pull-request review.
#[derive(Clone, Copy, Debug, Eq, Enum, PartialEq)]
pub enum GraphqlGithubPrReviewState {
    /// Review approved the pull request.
    Approved,
    /// Review requested changes.
    ChangesRequested,
    /// Review left comments without an approval decision.
    Commented,
}

impl From<GithubPrReviewState> for GraphqlGithubPrReviewState {
    fn from(value: GithubPrReviewState) -> Self {
        match value {
            GithubPrReviewState::Approved => Self::Approved,
            GithubPrReviewState::ChangesRequested => Self::ChangesRequested,
            GithubPrReviewState::Commented => Self::Commented,
        }
    }
}

/// GraphQL wrapper for fields shared by channel notification metadata.
pub struct GraphqlChannelNotificationCommon(model_notifications::CommonChannelMetadata);

/// Fields shared by channel notification metadata.
#[Object]
impl GraphqlChannelNotificationCommon {
    /// Channel type.
    async fn channel_type(&self) -> GraphqlNotificationChannelType {
        self.0.channel_type.into()
    }

    /// Channel display name.
    async fn channel_name(&self) -> &str {
        &self.0.channel_name
    }
}

/// GraphQL wrapper for fields shared by GitHub pull-request notification metadata.
pub struct GraphqlGithubPrNotificationCommon(GithubPrNotificationCommon);

/// Fields shared by GitHub pull-request notification metadata.
#[Object]
impl GraphqlGithubPrNotificationCommon {
    /// Internal foreign-entity identifier.
    async fn foreign_entity_id(&self) -> ID {
        ID(self.0.foreign_entity_id.to_string())
    }

    /// External GitHub key.
    async fn github_key(&self) -> &str {
        &self.0.github_key
    }

    /// Repository owner or organization.
    async fn owner(&self) -> &str {
        &self.0.owner
    }

    /// Repository name.
    async fn repo(&self) -> &str {
        &self.0.repo
    }

    /// Pull-request number.
    async fn number(&self) -> String {
        self.0.number.to_string()
    }

    /// Public pull-request URL.
    async fn url(&self) -> &str {
        &self.0.url
    }

    /// Compact pull-request display label.
    async fn display_name(&self) -> &str {
        &self.0.display_name
    }

    /// Pull-request title.
    async fn title(&self) -> &str {
        &self.0.title
    }

    /// Sender GitHub login.
    async fn sender_github_login(&self) -> Option<&str> {
        self.0.sender_github_login.as_deref()
    }

    /// Sender GitHub user identifier.
    async fn sender_github_user_id(&self) -> Option<&str> {
        self.0.sender_github_user_id.as_deref()
    }

    /// Sender GitHub avatar URL.
    async fn sender_github_avatar_url(&self) -> Option<&str> {
        self.0.sender_github_avatar_url.as_deref()
    }
}

/// GraphQL wrapper for channel mention metadata.
pub struct GraphqlChannelMentionMetadata(ChannelMentionMetadata);

/// Metadata for a channel mention notification.
#[Object]
impl GraphqlChannelMentionMetadata {
    /// Mentioning message identifier.
    async fn message_id(&self) -> &str {
        &self.0.message_id
    }

    /// Mentioning message content.
    async fn message_content(&self) -> &str {
        &self.0.message_content
    }

    /// Whether the message has attachments.
    async fn has_attachments(&self) -> bool {
        self.0.has_attachments
    }

    /// Thread identifier, when the mention is in a thread.
    async fn thread_id(&self) -> Option<&str> {
        self.0.thread_id.as_deref()
    }

    /// Display name for a non-user sender.
    async fn sender_display_name(&self) -> Option<&str> {
        self.0.sender_display_name.as_deref()
    }

    /// Channel metadata.
    #[graphql(flatten)]
    async fn channel(&self) -> GraphqlChannelNotificationCommon {
        GraphqlChannelNotificationCommon(self.0.common.clone())
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for document mention metadata.
pub struct GraphqlDocumentMentionMetadata(DocumentMentionMetadata);

/// Metadata for a document mention notification.
#[Object]
impl GraphqlDocumentMentionMetadata {
    /// Mentioned document name.
    async fn document_name(&self) -> &str {
        &self.0.document_name
    }

    /// Document owner identifier.
    async fn owner(&self) -> String {
        self.0.owner.to_string()
    }

    /// Document file type.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// Document subtype.
    async fn sub_type(&self) -> Option<GraphqlNotificationDocumentSubType> {
        self.0.sub_type.clone().map(Into::into)
    }

    /// Channel mention that referenced the document.
    #[graphql(flatten)]
    async fn channel(&self) -> GraphqlChannelMentionMetadata {
        GraphqlChannelMentionMetadata(self.0.channel.clone())
    }
}

/// GraphQL wrapper for a mention in document comment metadata.
pub struct GraphqlMentionedInDocumentCommentMetadata(MentionedInDocumentCommentMetadata);

/// Metadata for a mention in a document comment.
#[Object]
impl GraphqlMentionedInDocumentCommentMetadata {
    /// Document name.
    async fn document_name(&self) -> &str {
        &self.0.document_name
    }

    /// Document owner identifier.
    async fn owner(&self) -> String {
        self.0.owner.to_string()
    }

    /// Document file type.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// Document subtype.
    async fn sub_type(&self) -> Option<GraphqlNotificationDocumentSubType> {
        self.0.sub_type.clone().map(Into::into)
    }

    /// Mention identifier.
    async fn mention_id(&self) -> &str {
        &self.0.mention_id
    }

    /// Comment identifier.
    async fn comment_id(&self) -> i64 {
        self.0.comment_id
    }

    /// Comment thread identifier.
    async fn thread_id(&self) -> i64 {
        self.0.thread_id
    }

    /// Comment text.
    async fn text(&self) -> &str {
        &self.0.text
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for document comment thread reply metadata.
pub struct GraphqlRepliedToDocumentCommentThreadMetadata(RepliedToDocumentCommentThreadMetadata);

/// Metadata for a reply to a document comment thread.
#[Object]
impl GraphqlRepliedToDocumentCommentThreadMetadata {
    /// Document name.
    async fn document_name(&self) -> &str {
        &self.0.document_name
    }

    /// Document owner identifier.
    async fn owner(&self) -> String {
        self.0.owner.to_string()
    }

    /// Document file type.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// Document subtype.
    async fn sub_type(&self) -> Option<GraphqlNotificationDocumentSubType> {
        self.0.sub_type.clone().map(Into::into)
    }

    /// Comment identifier.
    async fn comment_id(&self) -> i64 {
        self.0.comment_id
    }

    /// Comment thread identifier.
    async fn thread_id(&self) -> i64 {
        self.0.thread_id
    }

    /// Reply text.
    async fn text(&self) -> &str {
        &self.0.text
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for document comment metadata.
pub struct GraphqlCommentedOnDocumentMetadata(CommentedOnDocumentMetadata);

/// Metadata for a comment on a document.
#[Object]
impl GraphqlCommentedOnDocumentMetadata {
    /// Document name.
    async fn document_name(&self) -> &str {
        &self.0.document_name
    }

    /// Document owner identifier.
    async fn owner(&self) -> String {
        self.0.owner.to_string()
    }

    /// Document file type.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// Document subtype.
    async fn sub_type(&self) -> Option<GraphqlNotificationDocumentSubType> {
        self.0.sub_type.clone().map(Into::into)
    }

    /// Comment identifier.
    async fn comment_id(&self) -> i64 {
        self.0.comment_id
    }

    /// Comment thread identifier.
    async fn thread_id(&self) -> i64 {
        self.0.thread_id
    }

    /// Comment text.
    async fn text(&self) -> &str {
        &self.0.text
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for channel invitation metadata.
pub struct GraphqlChannelInviteMetadata(ChannelInviteMetadata);

/// Metadata for a channel invitation.
#[Object]
impl GraphqlChannelInviteMetadata {
    /// Inviting user identifier.
    async fn invited_by(&self) -> String {
        self.0.invited_by.to_string()
    }

    /// Channel name.
    async fn channel_name(&self) -> &str {
        &self.0.channel_name
    }

    /// Message content associated with the invitation.
    async fn message_content(&self) -> Option<&str> {
        self.0.message_content.as_deref()
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for sent channel message metadata.
pub struct GraphqlChannelMessageSendMetadata(ChannelMessageSendMetadata);

/// Metadata for a newly sent channel message.
#[Object]
impl GraphqlChannelMessageSendMetadata {
    /// Sending user identifier.
    async fn sender(&self) -> Option<String> {
        self.0.sender.as_ref().map(ToString::to_string)
    }

    /// Display name for a non-user sender.
    async fn sender_display_name(&self) -> Option<&str> {
        self.0.sender_display_name.as_deref()
    }

    /// Message content.
    async fn message_content(&self) -> &str {
        &self.0.message_content
    }

    /// Message identifier.
    async fn message_id(&self) -> &str {
        &self.0.message_id
    }

    /// Whether the message has attachments.
    async fn has_attachments(&self) -> bool {
        self.0.has_attachments
    }

    /// Channel metadata.
    #[graphql(flatten)]
    async fn channel(&self) -> GraphqlChannelNotificationCommon {
        GraphqlChannelNotificationCommon(self.0.common.clone())
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for channel reply metadata.
pub struct GraphqlChannelReplyMetadata(ChannelReplyMetadata);

/// Metadata for a reply to a channel thread.
#[Object]
impl GraphqlChannelReplyMetadata {
    /// Thread identifier.
    async fn thread_id(&self) -> &str {
        &self.0.thread_id
    }

    /// Reply message identifier.
    async fn message_id(&self) -> &str {
        &self.0.message_id
    }

    /// Replying user identifier.
    async fn user_id(&self) -> Option<String> {
        self.0.user_id.as_ref().map(ToString::to_string)
    }

    /// Display name for a non-user sender.
    async fn sender_display_name(&self) -> Option<&str> {
        self.0.sender_display_name.as_deref()
    }

    /// Reply content.
    async fn message_content(&self) -> &str {
        &self.0.message_content
    }

    /// Whether the reply has attachments.
    async fn has_attachments(&self) -> bool {
        self.0.has_attachments
    }

    /// Root-message sender identifier.
    async fn thread_parent_sender_id(&self) -> Option<String> {
        self.0
            .thread_parent_sender_id
            .as_ref()
            .map(ToString::to_string)
    }

    /// Channel metadata.
    #[graphql(flatten)]
    async fn channel(&self) -> GraphqlChannelNotificationCommon {
        GraphqlChannelNotificationCommon(self.0.common.clone())
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for started call metadata.
pub struct GraphqlCallStartedMetadata(CallStartedMetadata);

/// Metadata for a started call.
#[Object]
impl GraphqlCallStartedMetadata {
    /// Channel name.
    async fn channel_name(&self) -> Option<&str> {
        self.0.channel_name.as_deref()
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for newly received email metadata.
pub struct GraphqlNewEmailMetadata(NewEmailMetadata);

/// Metadata for a newly received email.
#[Object]
impl GraphqlNewEmailMetadata {
    /// Sender email address.
    async fn sender(&self) -> Option<&str> {
        self.0.sender.as_deref()
    }

    /// Recipient email address.
    async fn to_email(&self) -> &str {
        &self.0.to_email
    }

    /// Email thread identifier.
    async fn thread_id(&self) -> &str {
        &self.0.thread_id
    }

    /// Email subject.
    async fn subject(&self) -> &str {
        &self.0.subject
    }

    /// Email snippet.
    async fn snippet(&self) -> &str {
        &self.0.snippet
    }
}

/// GraphQL wrapper for inbox reauthentication metadata.
pub struct GraphqlInboxReauthRequiredMetadata(InboxReauthRequiredMetadata);

/// Metadata for an inbox that requires reauthentication.
#[Object]
impl GraphqlInboxReauthRequiredMetadata {
    /// Inbox email address.
    async fn email_address(&self) -> &str {
        &self.0.email_address
    }
}

/// GraphQL wrapper for team invitation metadata.
pub struct GraphqlInviteToTeamMetadata(InviteToTeamMetadata);

/// Metadata for a team invitation.
#[Object]
impl GraphqlInviteToTeamMetadata {
    /// Team name.
    async fn team_name(&self) -> &str {
        &self.0.team_name
    }

    /// Team identifier.
    async fn team_id(&self) -> ID {
        ID(self.0.team_id.to_string())
    }

    /// Team invitation identifier.
    async fn team_invite_id(&self) -> ID {
        ID(self.0.team_invite_id.to_string())
    }

    /// Inviting user identifier.
    async fn invited_by(&self) -> String {
        self.0.invited_by.to_string()
    }

    /// Invited role.
    async fn role(&self) -> Option<&str> {
        self.0.role.as_deref()
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<String> {
        self.0
            .sender_profile_picture_url
            .as_ref()
            .map(ToString::to_string)
    }
}

/// GraphQL wrapper for task assignment metadata.
pub struct GraphqlTaskAssignedMetadata(TaskAssignedMetadata);

/// Metadata for a task assignment.
#[Object]
impl GraphqlTaskAssignedMetadata {
    /// Task identifier.
    async fn task_id(&self) -> &str {
        &self.0.task_id
    }

    /// Task name.
    async fn task_name(&self) -> Option<&str> {
        self.0.task_name.as_deref()
    }

    /// Task document subtype.
    async fn sub_type(&self) -> Option<GraphqlNotificationDocumentSubType> {
        self.0.sub_type.clone().map(Into::into)
    }

    /// Assigning user identifier.
    async fn assigned_by(&self) -> String {
        self.0.assigned_by.to_string()
    }

    /// Sender profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}

/// GraphQL wrapper for reminder metadata.
pub struct GraphqlReminderMetadata(ReminderMetadata);

/// Metadata for a due reminder.
#[Object]
impl GraphqlReminderMetadata {
    /// Reminder identifier.
    async fn reminder_id(&self) -> ID {
        ID(self.0.reminder_id.to_string())
    }

    /// Reminder description.
    async fn description(&self) -> &str {
        &self.0.description
    }

    /// Which firing this notification is for, in RFC 3339 format.
    ///
    /// The counterpart of a calendar alarm's `occurrenceKey`: it is what tells
    /// two notifications from the same recurring reminder apart. Absent on
    /// notifications written before recurring dispatch existed.
    async fn scheduled_for(&self) -> Option<String> {
        self.0.scheduled_for.map(|timestamp| timestamp.to_rfc3339())
    }
}

/// GraphQL wrapper for calendar event reminder metadata.
pub struct GraphqlCalendarEventReminderMetadata(CalendarEventReminderMetadata);

/// Metadata for a due calendar event reminder.
#[Object]
impl GraphqlCalendarEventReminderMetadata {
    /// Calendar event identifier.
    async fn event_id(&self) -> ID {
        ID(self.0.event_id.to_string())
    }

    /// Stable occurrence key of the event instance.
    async fn occurrence_key(&self) -> &str {
        &self.0.occurrence_key
    }

    /// Event display title.
    async fn title(&self) -> &str {
        &self.0.title
    }

    /// Timed event start in RFC 3339 format.
    async fn starts_at(&self) -> Option<String> {
        self.0.starts_at.map(|timestamp| timestamp.to_rfc3339())
    }

    /// Timed event end in RFC 3339 format.
    async fn ends_at(&self) -> Option<String> {
        self.0.ends_at.map(|timestamp| timestamp.to_rfc3339())
    }

    /// All-day event start date in ISO 8601 format.
    async fn start_date(&self) -> Option<String> {
        self.0.start_date.map(|date| date.to_string())
    }

    /// IANA time zone used to render the event.
    async fn time_zone(&self) -> Option<&str> {
        self.0.time_zone.as_deref()
    }

    /// Minutes before the event start when the alarm fires.
    async fn minutes_before(&self) -> i32 {
        self.0.minutes_before
    }
}

/// GraphQL wrapper for AI response metadata.
pub struct GraphqlAiResponseMetadata(AiResponseMetadata);

/// Metadata for an AI response.
#[Object]
impl GraphqlAiResponseMetadata {
    /// AI response summary.
    async fn summary(&self) -> &str {
        &self.0.summary
    }

    /// Response message identifier.
    async fn message_id(&self) -> &str {
        &self.0.message_id
    }
}

/// GraphQL wrapper for GitHub pull-request lifecycle metadata.
pub struct GraphqlGithubPrStatusChangedMetadata(GithubPrStatusChanged);

/// Metadata for a GitHub pull-request lifecycle change.
#[Object]
impl GraphqlGithubPrStatusChangedMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Current pull-request status.
    async fn status(&self) -> GraphqlGithubPrEventStatus {
        self.0.status.into()
    }

    /// Triggering webhook action.
    async fn action(&self) -> GraphqlGithubPrEventAction {
        self.0.action.into()
    }

    /// Previous pull-request status.
    async fn previous_status(&self) -> Option<GraphqlGithubPrEventStatus> {
        self.0.previous_status.map(Into::into)
    }

    /// Head branch.
    async fn head_branch(&self) -> Option<&str> {
        self.0.head_branch.as_deref()
    }

    /// Base branch.
    async fn base_branch(&self) -> Option<&str> {
        self.0.base_branch.as_deref()
    }

    /// Merge timestamp in RFC 3339 format.
    async fn merged_at(&self) -> Option<String> {
        self.0.merged_at.map(|timestamp| timestamp.to_rfc3339())
    }
}

/// GraphQL wrapper for GitHub pull-request check-run metadata.
pub struct GraphqlGithubPrCheckRunMetadata(GithubPrCheckRun);

/// Metadata for a completed GitHub pull-request check run.
#[Object]
impl GraphqlGithubPrCheckRunMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Check-run GitHub identifier.
    async fn check_run_github_id(&self) -> ID {
        ID(self.0.check_run_github_id.to_string())
    }

    /// Check name.
    async fn check_name(&self) -> &str {
        &self.0.check_name
    }

    /// Raw check status.
    async fn check_status(&self) -> &str {
        &self.0.check_status
    }

    /// Raw check conclusion.
    async fn conclusion(&self) -> &str {
        &self.0.conclusion
    }

    /// Normalized check state.
    async fn state(&self) -> GraphqlGithubPrCheckRunState {
        self.0.state.into()
    }

    /// Public check URL.
    async fn check_url(&self) -> &str {
        &self.0.check_url
    }

    /// Completion timestamp in RFC 3339 format.
    async fn completed_at(&self) -> String {
        self.0.completed_at.to_rfc3339()
    }
}

/// GraphQL wrapper for GitHub review-request metadata.
pub struct GraphqlGithubReviewRequestedMetadata(GithubReviewRequested);

/// Metadata for a GitHub pull-request review request.
#[Object]
impl GraphqlGithubReviewRequestedMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Requested reviewer GitHub login.
    async fn requested_reviewer_github_login(&self) -> Option<&str> {
        self.0.requested_reviewer_github_login.as_deref()
    }

    /// Requested reviewer GitHub user identifier.
    async fn requested_reviewer_github_user_id(&self) -> Option<&str> {
        self.0.requested_reviewer_github_user_id.as_deref()
    }
}

/// GraphQL wrapper for GitHub pull-request comment metadata.
pub struct GraphqlGithubPrCommentMetadata(GithubPrComment);

/// Metadata for a GitHub pull-request comment.
#[Object]
impl GraphqlGithubPrCommentMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Comment kind.
    async fn comment_kind(&self) -> GraphqlGithubPrCommentKind {
        self.0.comment_kind.into()
    }

    /// Comment GitHub identifier.
    async fn comment_github_id(&self) -> Option<ID> {
        self.0.comment_github_id.map(|id| ID(id.to_string()))
    }

    /// Public comment URL.
    async fn comment_url(&self) -> Option<&str> {
        self.0.comment_url.as_deref()
    }

    /// Truncated comment body.
    async fn comment_snippet(&self) -> &str {
        &self.0.comment_snippet
    }
}

/// GraphQL wrapper for GitHub pull-request mention metadata.
pub struct GraphqlGithubPrMentionMetadata(GithubPrMention);

/// Metadata for a GitHub pull-request mention.
#[Object]
impl GraphqlGithubPrMentionMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Mention location.
    async fn location(&self) -> GraphqlGithubPrMentionLocation {
        self.0.location.into()
    }

    /// Comment or review GitHub identifier.
    async fn comment_github_id(&self) -> Option<ID> {
        self.0.comment_github_id.map(|id| ID(id.to_string()))
    }

    /// Public URL for the mentioning text.
    async fn comment_url(&self) -> Option<&str> {
        self.0.comment_url.as_deref()
    }

    /// Truncated mentioning text.
    async fn text_snippet(&self) -> &str {
        &self.0.text_snippet
    }
}

/// GraphQL wrapper for GitHub pull-request review metadata.
pub struct GraphqlGithubPrReviewMetadata(GithubPrReview);

/// Metadata for a GitHub pull-request review.
#[Object]
impl GraphqlGithubPrReviewMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    async fn common(&self) -> GraphqlGithubPrNotificationCommon {
        GraphqlGithubPrNotificationCommon(self.0.common.clone())
    }

    /// Review GitHub identifier.
    async fn review_github_id(&self) -> Option<ID> {
        self.0.review_github_id.map(|id| ID(id.to_string()))
    }

    /// Public review URL.
    async fn review_url(&self) -> Option<&str> {
        self.0.review_url.as_deref()
    }

    /// Review state.
    async fn state(&self) -> GraphqlGithubPrReviewState {
        self.0.state.into()
    }

    /// Truncated review body.
    async fn review_snippet(&self) -> Option<&str> {
        self.0.review_snippet.as_deref()
    }
}

/// Typed GraphQL union containing every supported notification event payload.
#[derive(Union)]
pub enum GraphqlNotifEvent {
    /// Channel mention metadata.
    ChannelMention(GraphqlChannelMentionMetadata),
    /// Document mention metadata.
    DocumentMention(GraphqlDocumentMentionMetadata),
    /// Document-comment mention metadata.
    MentionedInDocumentComment(GraphqlMentionedInDocumentCommentMetadata),
    /// Document-comment thread reply metadata.
    RepliedToDocumentCommentThread(GraphqlRepliedToDocumentCommentThreadMetadata),
    /// Document comment metadata.
    CommentedOnDocument(GraphqlCommentedOnDocumentMetadata),
    /// Channel invitation metadata.
    ChannelInvite(GraphqlChannelInviteMetadata),
    /// Channel message metadata.
    ChannelMessageSend(GraphqlChannelMessageSendMetadata),
    /// Channel reply metadata.
    ChannelMessageReply(GraphqlChannelReplyMetadata),
    /// Started-call metadata.
    CallStarted(GraphqlCallStartedMetadata),
    /// New-email metadata.
    NewEmail(GraphqlNewEmailMetadata),
    /// Inbox reauthentication metadata.
    InboxReauthRequired(GraphqlInboxReauthRequiredMetadata),
    /// Team invitation metadata.
    InviteToTeam(GraphqlInviteToTeamMetadata),
    /// Task assignment metadata.
    TaskAssigned(GraphqlTaskAssignedMetadata),
    /// Reminder metadata.
    Reminder(GraphqlReminderMetadata),
    /// Calendar event reminder metadata.
    CalendarEventReminder(GraphqlCalendarEventReminderMetadata),
    /// AI response metadata.
    AiResponse(GraphqlAiResponseMetadata),
    /// GitHub pull-request lifecycle metadata.
    GithubPrStatusChanged(GraphqlGithubPrStatusChangedMetadata),
    /// GitHub pull-request check-run metadata.
    GithubPrCheckRun(GraphqlGithubPrCheckRunMetadata),
    /// GitHub review-request metadata.
    GithubReviewRequested(GraphqlGithubReviewRequestedMetadata),
    /// GitHub pull-request comment metadata.
    GithubPrComment(GraphqlGithubPrCommentMetadata),
    /// GitHub pull-request mention metadata.
    GithubPrMention(GraphqlGithubPrMentionMetadata),
    /// GitHub pull-request review metadata.
    GithubPrReview(GraphqlGithubPrReviewMetadata),
}

impl From<NotifEvent> for GraphqlNotifEvent {
    fn from(value: NotifEvent) -> Self {
        match value {
            NotifEvent::ChannelMention(metadata) => {
                Self::ChannelMention(GraphqlChannelMentionMetadata(metadata))
            }
            NotifEvent::DocumentMention(metadata) => {
                Self::DocumentMention(GraphqlDocumentMentionMetadata(metadata))
            }
            NotifEvent::MentionedInDocumentComment(metadata) => Self::MentionedInDocumentComment(
                GraphqlMentionedInDocumentCommentMetadata(metadata),
            ),
            NotifEvent::RepliedToDocumentCommentThread(metadata) => {
                Self::RepliedToDocumentCommentThread(GraphqlRepliedToDocumentCommentThreadMetadata(
                    metadata,
                ))
            }
            NotifEvent::CommentedOnDocument(metadata) => {
                Self::CommentedOnDocument(GraphqlCommentedOnDocumentMetadata(metadata))
            }
            NotifEvent::ChannelInvite(metadata) => {
                Self::ChannelInvite(GraphqlChannelInviteMetadata(metadata))
            }
            NotifEvent::ChannelMessageSend(metadata) => {
                Self::ChannelMessageSend(GraphqlChannelMessageSendMetadata(metadata))
            }
            NotifEvent::ChannelMessageReply(metadata) => {
                Self::ChannelMessageReply(GraphqlChannelReplyMetadata(metadata))
            }
            NotifEvent::CallStarted(metadata) => {
                Self::CallStarted(GraphqlCallStartedMetadata(metadata))
            }
            NotifEvent::NewEmail(metadata) => Self::NewEmail(GraphqlNewEmailMetadata(metadata)),
            NotifEvent::InboxReauthRequired(metadata) => {
                Self::InboxReauthRequired(GraphqlInboxReauthRequiredMetadata(metadata))
            }
            NotifEvent::InviteToTeam(metadata) => {
                Self::InviteToTeam(GraphqlInviteToTeamMetadata(metadata))
            }
            NotifEvent::TaskAssigned(metadata) => {
                Self::TaskAssigned(GraphqlTaskAssignedMetadata(metadata))
            }
            NotifEvent::Reminder(metadata) => Self::Reminder(GraphqlReminderMetadata(metadata)),
            NotifEvent::CalendarEventReminder(metadata) => {
                Self::CalendarEventReminder(GraphqlCalendarEventReminderMetadata(metadata))
            }
            NotifEvent::AiResponse(metadata) => {
                Self::AiResponse(GraphqlAiResponseMetadata(metadata))
            }
            NotifEvent::GithubPrStatusChanged(metadata) => {
                Self::GithubPrStatusChanged(GraphqlGithubPrStatusChangedMetadata(metadata))
            }
            NotifEvent::GithubPrCheckRun(metadata) => {
                Self::GithubPrCheckRun(GraphqlGithubPrCheckRunMetadata(metadata))
            }
            NotifEvent::GithubReviewRequested(metadata) => {
                Self::GithubReviewRequested(GraphqlGithubReviewRequestedMetadata(metadata))
            }
            NotifEvent::GithubPrComment(metadata) => {
                Self::GithubPrComment(GraphqlGithubPrCommentMetadata(metadata))
            }
            NotifEvent::GithubPrMention(metadata) => {
                Self::GithubPrMention(GraphqlGithubPrMentionMetadata(metadata))
            }
            NotifEvent::GithubPrReview(metadata) => {
                Self::GithubPrReview(GraphqlGithubPrReviewMetadata(metadata))
            }
        }
    }
}
