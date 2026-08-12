//! Typed GraphQL output models for realtime notification event metadata.

use async_graphql::{Enum, ID, SimpleObject, Union};
use model_notifications::{
    AiResponseMetadata, CallStartedMetadata, ChannelInviteMetadata, ChannelMentionMetadata,
    ChannelMessageSendMetadata, ChannelReplyMetadata, ChannelType, CommentedOnDocumentMetadata,
    DocumentMentionMetadata, GithubPrCheckRun, GithubPrCheckRunState, GithubPrComment,
    GithubPrCommentKind, GithubPrEventAction, GithubPrEventStatus, GithubPrMention,
    GithubPrMentionLocation, GithubPrNotificationCommon, GithubPrReview, GithubPrReviewState,
    GithubPrStatusChanged, GithubReviewRequested, InboxReauthRequiredMetadata,
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

/// Fields shared by channel notification metadata.
#[derive(SimpleObject)]
pub struct GraphqlChannelNotificationCommon {
    /// Channel type.
    channel_type: GraphqlNotificationChannelType,
    /// Channel display name.
    channel_name: String,
}

impl From<model_notifications::CommonChannelMetadata> for GraphqlChannelNotificationCommon {
    fn from(value: model_notifications::CommonChannelMetadata) -> Self {
        Self {
            channel_type: value.channel_type.into(),
            channel_name: value.channel_name,
        }
    }
}

/// Fields shared by GitHub pull-request notification metadata.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrNotificationCommon {
    /// Internal foreign-entity identifier.
    foreign_entity_id: ID,
    /// External GitHub key.
    github_key: String,
    /// Repository owner or organization.
    owner: String,
    /// Repository name.
    repo: String,
    /// Pull-request number.
    number: String,
    /// Public pull-request URL.
    url: String,
    /// Compact pull-request display label.
    display_name: String,
    /// Pull-request title.
    title: String,
    /// Sender GitHub login.
    sender_github_login: Option<String>,
    /// Sender GitHub user identifier.
    sender_github_user_id: Option<String>,
    /// Sender GitHub avatar URL.
    sender_github_avatar_url: Option<String>,
}

impl From<GithubPrNotificationCommon> for GraphqlGithubPrNotificationCommon {
    fn from(value: GithubPrNotificationCommon) -> Self {
        Self {
            foreign_entity_id: ID(value.foreign_entity_id.to_string()),
            github_key: value.github_key,
            owner: value.owner,
            repo: value.repo,
            number: value.number.to_string(),
            url: value.url,
            display_name: value.display_name,
            title: value.title,
            sender_github_login: value.sender_github_login,
            sender_github_user_id: value.sender_github_user_id,
            sender_github_avatar_url: value.sender_github_avatar_url,
        }
    }
}

/// Metadata for a channel mention notification.
#[derive(SimpleObject)]
pub struct GraphqlChannelMentionMetadata {
    /// Mentioning message identifier.
    message_id: String,
    /// Mentioning message content.
    message_content: String,
    /// Whether the message has attachments.
    has_attachments: bool,
    /// Thread identifier, when the mention is in a thread.
    thread_id: Option<String>,
    /// Display name for a non-user sender.
    sender_display_name: Option<String>,
    /// Channel metadata.
    #[graphql(flatten)]
    channel: GraphqlChannelNotificationCommon,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<ChannelMentionMetadata> for GraphqlChannelMentionMetadata {
    fn from(value: ChannelMentionMetadata) -> Self {
        Self {
            message_id: value.message_id,
            message_content: value.message_content,
            has_attachments: value.has_attachments,
            thread_id: value.thread_id,
            sender_display_name: value.sender_display_name,
            channel: value.common.into(),
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a document mention notification.
#[derive(SimpleObject)]
pub struct GraphqlDocumentMentionMetadata {
    /// Mentioned document name.
    document_name: String,
    /// Document owner identifier.
    owner: String,
    /// Document file type.
    file_type: Option<String>,
    /// Document subtype.
    sub_type: Option<GraphqlNotificationDocumentSubType>,
    /// Channel mention that referenced the document.
    #[graphql(flatten)]
    channel: GraphqlChannelMentionMetadata,
}

impl From<DocumentMentionMetadata> for GraphqlDocumentMentionMetadata {
    fn from(value: DocumentMentionMetadata) -> Self {
        Self {
            document_name: value.document_name,
            owner: value.owner.to_string(),
            file_type: value.file_type,
            sub_type: value.sub_type.map(Into::into),
            channel: value.channel.into(),
        }
    }
}

/// Metadata for a mention in a document comment.
#[derive(SimpleObject)]
pub struct GraphqlMentionedInDocumentCommentMetadata {
    /// Document name.
    document_name: String,
    /// Document owner identifier.
    owner: String,
    /// Document file type.
    file_type: Option<String>,
    /// Document subtype.
    sub_type: Option<GraphqlNotificationDocumentSubType>,
    /// Mention identifier.
    mention_id: String,
    /// Comment identifier.
    comment_id: i64,
    /// Comment thread identifier.
    thread_id: i64,
    /// Comment text.
    text: String,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<MentionedInDocumentCommentMetadata> for GraphqlMentionedInDocumentCommentMetadata {
    fn from(value: MentionedInDocumentCommentMetadata) -> Self {
        Self {
            document_name: value.document_name,
            owner: value.owner.to_string(),
            file_type: value.file_type,
            sub_type: value.sub_type.map(Into::into),
            mention_id: value.mention_id,
            comment_id: value.comment_id,
            thread_id: value.thread_id,
            text: value.text,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a reply to a document comment thread.
#[derive(SimpleObject)]
pub struct GraphqlRepliedToDocumentCommentThreadMetadata {
    /// Document name.
    document_name: String,
    /// Document owner identifier.
    owner: String,
    /// Document file type.
    file_type: Option<String>,
    /// Document subtype.
    sub_type: Option<GraphqlNotificationDocumentSubType>,
    /// Comment identifier.
    comment_id: i64,
    /// Comment thread identifier.
    thread_id: i64,
    /// Reply text.
    text: String,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<RepliedToDocumentCommentThreadMetadata>
    for GraphqlRepliedToDocumentCommentThreadMetadata
{
    fn from(value: RepliedToDocumentCommentThreadMetadata) -> Self {
        Self {
            document_name: value.document_name,
            owner: value.owner.to_string(),
            file_type: value.file_type,
            sub_type: value.sub_type.map(Into::into),
            comment_id: value.comment_id,
            thread_id: value.thread_id,
            text: value.text,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a comment on a document.
#[derive(SimpleObject)]
pub struct GraphqlCommentedOnDocumentMetadata {
    /// Document name.
    document_name: String,
    /// Document owner identifier.
    owner: String,
    /// Document file type.
    file_type: Option<String>,
    /// Document subtype.
    sub_type: Option<GraphqlNotificationDocumentSubType>,
    /// Comment identifier.
    comment_id: i64,
    /// Comment thread identifier.
    thread_id: i64,
    /// Comment text.
    text: String,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<CommentedOnDocumentMetadata> for GraphqlCommentedOnDocumentMetadata {
    fn from(value: CommentedOnDocumentMetadata) -> Self {
        Self {
            document_name: value.document_name,
            owner: value.owner.to_string(),
            file_type: value.file_type,
            sub_type: value.sub_type.map(Into::into),
            comment_id: value.comment_id,
            thread_id: value.thread_id,
            text: value.text,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a channel invitation.
#[derive(SimpleObject)]
pub struct GraphqlChannelInviteMetadata {
    /// Inviting user identifier.
    invited_by: String,
    /// Channel name.
    channel_name: String,
    /// Message content associated with the invitation.
    message_content: Option<String>,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<ChannelInviteMetadata> for GraphqlChannelInviteMetadata {
    fn from(value: ChannelInviteMetadata) -> Self {
        Self {
            invited_by: value.invited_by.to_string(),
            channel_name: value.channel_name,
            message_content: value.message_content,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a newly sent channel message.
#[derive(SimpleObject)]
pub struct GraphqlChannelMessageSendMetadata {
    /// Sending user identifier.
    sender: Option<String>,
    /// Display name for a non-user sender.
    sender_display_name: Option<String>,
    /// Message content.
    message_content: String,
    /// Message identifier.
    message_id: String,
    /// Whether the message has attachments.
    has_attachments: bool,
    /// Channel metadata.
    #[graphql(flatten)]
    channel: GraphqlChannelNotificationCommon,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<ChannelMessageSendMetadata> for GraphqlChannelMessageSendMetadata {
    fn from(value: ChannelMessageSendMetadata) -> Self {
        Self {
            sender: value.sender.map(|sender| sender.to_string()),
            sender_display_name: value.sender_display_name,
            message_content: value.message_content,
            message_id: value.message_id,
            has_attachments: value.has_attachments,
            channel: value.common.into(),
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a reply to a channel thread.
#[derive(SimpleObject)]
pub struct GraphqlChannelReplyMetadata {
    /// Thread identifier.
    thread_id: String,
    /// Reply message identifier.
    message_id: String,
    /// Replying user identifier.
    user_id: Option<String>,
    /// Display name for a non-user sender.
    sender_display_name: Option<String>,
    /// Reply content.
    message_content: String,
    /// Whether the reply has attachments.
    has_attachments: bool,
    /// Root-message sender identifier.
    thread_parent_sender_id: Option<String>,
    /// Channel metadata.
    #[graphql(flatten)]
    channel: GraphqlChannelNotificationCommon,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<ChannelReplyMetadata> for GraphqlChannelReplyMetadata {
    fn from(value: ChannelReplyMetadata) -> Self {
        Self {
            thread_id: value.thread_id,
            message_id: value.message_id,
            user_id: value.user_id.map(|user| user.to_string()),
            sender_display_name: value.sender_display_name,
            message_content: value.message_content,
            has_attachments: value.has_attachments,
            thread_parent_sender_id: value.thread_parent_sender_id.map(|user| user.to_string()),
            channel: value.common.into(),
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a started call.
#[derive(SimpleObject)]
pub struct GraphqlCallStartedMetadata {
    /// Channel name.
    channel_name: Option<String>,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<CallStartedMetadata> for GraphqlCallStartedMetadata {
    fn from(value: CallStartedMetadata) -> Self {
        Self {
            channel_name: value.channel_name,
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a newly received email.
#[derive(SimpleObject)]
pub struct GraphqlNewEmailMetadata {
    /// Sender email address.
    sender: Option<String>,
    /// Recipient email address.
    to_email: String,
    /// Email thread identifier.
    thread_id: String,
    /// Email subject.
    subject: String,
    /// Email snippet.
    snippet: String,
}

impl From<NewEmailMetadata> for GraphqlNewEmailMetadata {
    fn from(value: NewEmailMetadata) -> Self {
        Self {
            sender: value.sender,
            to_email: value.to_email,
            thread_id: value.thread_id,
            subject: value.subject,
            snippet: value.snippet,
        }
    }
}

/// Metadata for an inbox that requires reauthentication.
#[derive(SimpleObject)]
pub struct GraphqlInboxReauthRequiredMetadata {
    /// Inbox email address.
    email_address: String,
}

impl From<InboxReauthRequiredMetadata> for GraphqlInboxReauthRequiredMetadata {
    fn from(value: InboxReauthRequiredMetadata) -> Self {
        Self {
            email_address: value.email_address,
        }
    }
}

/// Metadata for a team invitation.
#[derive(SimpleObject)]
pub struct GraphqlInviteToTeamMetadata {
    /// Team name.
    team_name: String,
    /// Team identifier.
    team_id: ID,
    /// Team invitation identifier.
    team_invite_id: ID,
    /// Inviting user identifier.
    invited_by: String,
    /// Invited role.
    role: Option<String>,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<InviteToTeamMetadata> for GraphqlInviteToTeamMetadata {
    fn from(value: InviteToTeamMetadata) -> Self {
        Self {
            team_name: value.team_name,
            team_id: ID(value.team_id.to_string()),
            team_invite_id: ID(value.team_invite_id.to_string()),
            invited_by: value.invited_by.to_string(),
            role: value.role,
            sender_profile_picture_url: value.sender_profile_picture_url.map(|url| url.to_string()),
        }
    }
}

/// Metadata for a task assignment.
#[derive(SimpleObject)]
pub struct GraphqlTaskAssignedMetadata {
    /// Task identifier.
    task_id: String,
    /// Task name.
    task_name: Option<String>,
    /// Task document subtype.
    sub_type: Option<GraphqlNotificationDocumentSubType>,
    /// Assigning user identifier.
    assigned_by: String,
    /// Sender profile-picture URL.
    sender_profile_picture_url: Option<String>,
}

impl From<TaskAssignedMetadata> for GraphqlTaskAssignedMetadata {
    fn from(value: TaskAssignedMetadata) -> Self {
        Self {
            task_id: value.task_id,
            task_name: value.task_name,
            sub_type: value.sub_type.map(Into::into),
            assigned_by: value.assigned_by.to_string(),
            sender_profile_picture_url: value.sender_profile_picture_url,
        }
    }
}

/// Metadata for a due reminder.
#[derive(SimpleObject)]
pub struct GraphqlReminderMetadata {
    /// Reminder identifier.
    reminder_id: ID,
    /// Reminder description.
    description: String,
}

impl From<ReminderMetadata> for GraphqlReminderMetadata {
    fn from(value: ReminderMetadata) -> Self {
        Self {
            reminder_id: ID(value.reminder_id.to_string()),
            description: value.description,
        }
    }
}

/// Metadata for an AI response.
#[derive(SimpleObject)]
pub struct GraphqlAiResponseMetadata {
    /// AI response summary.
    summary: String,
    /// Response message identifier.
    message_id: String,
}

impl From<AiResponseMetadata> for GraphqlAiResponseMetadata {
    fn from(value: AiResponseMetadata) -> Self {
        Self {
            summary: value.summary,
            message_id: value.message_id,
        }
    }
}

/// Metadata for a GitHub pull-request lifecycle change.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrStatusChangedMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Current pull-request status.
    status: GraphqlGithubPrEventStatus,
    /// Triggering webhook action.
    action: GraphqlGithubPrEventAction,
    /// Previous pull-request status.
    previous_status: Option<GraphqlGithubPrEventStatus>,
    /// Head branch.
    head_branch: Option<String>,
    /// Base branch.
    base_branch: Option<String>,
    /// Merge timestamp in RFC 3339 format.
    merged_at: Option<String>,
}

impl From<GithubPrStatusChanged> for GraphqlGithubPrStatusChangedMetadata {
    fn from(value: GithubPrStatusChanged) -> Self {
        Self {
            common: value.common.into(),
            status: value.status.into(),
            action: value.action.into(),
            previous_status: value.previous_status.map(Into::into),
            head_branch: value.head_branch,
            base_branch: value.base_branch,
            merged_at: value.merged_at.map(|timestamp| timestamp.to_rfc3339()),
        }
    }
}

/// Metadata for a completed GitHub pull-request check run.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrCheckRunMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Check-run GitHub identifier.
    check_run_github_id: ID,
    /// Check name.
    check_name: String,
    /// Raw check status.
    check_status: String,
    /// Raw check conclusion.
    conclusion: String,
    /// Normalized check state.
    state: GraphqlGithubPrCheckRunState,
    /// Public check URL.
    check_url: String,
    /// Completion timestamp in RFC 3339 format.
    completed_at: String,
}

impl From<GithubPrCheckRun> for GraphqlGithubPrCheckRunMetadata {
    fn from(value: GithubPrCheckRun) -> Self {
        Self {
            common: value.common.into(),
            check_run_github_id: ID(value.check_run_github_id.to_string()),
            check_name: value.check_name,
            check_status: value.check_status,
            conclusion: value.conclusion,
            state: value.state.into(),
            check_url: value.check_url,
            completed_at: value.completed_at.to_rfc3339(),
        }
    }
}

/// Metadata for a GitHub pull-request review request.
#[derive(SimpleObject)]
pub struct GraphqlGithubReviewRequestedMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Requested reviewer GitHub login.
    requested_reviewer_github_login: Option<String>,
    /// Requested reviewer GitHub user identifier.
    requested_reviewer_github_user_id: Option<String>,
}

impl From<GithubReviewRequested> for GraphqlGithubReviewRequestedMetadata {
    fn from(value: GithubReviewRequested) -> Self {
        Self {
            common: value.common.into(),
            requested_reviewer_github_login: value.requested_reviewer_github_login,
            requested_reviewer_github_user_id: value.requested_reviewer_github_user_id,
        }
    }
}

/// Metadata for a GitHub pull-request comment.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrCommentMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Comment kind.
    comment_kind: GraphqlGithubPrCommentKind,
    /// Comment GitHub identifier.
    comment_github_id: Option<ID>,
    /// Public comment URL.
    comment_url: Option<String>,
    /// Truncated comment body.
    comment_snippet: String,
}

impl From<GithubPrComment> for GraphqlGithubPrCommentMetadata {
    fn from(value: GithubPrComment) -> Self {
        Self {
            common: value.common.into(),
            comment_kind: value.comment_kind.into(),
            comment_github_id: value.comment_github_id.map(|id| ID(id.to_string())),
            comment_url: value.comment_url,
            comment_snippet: value.comment_snippet,
        }
    }
}

/// Metadata for a GitHub pull-request mention.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrMentionMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Mention location.
    location: GraphqlGithubPrMentionLocation,
    /// Comment or review GitHub identifier.
    comment_github_id: Option<ID>,
    /// Public URL for the mentioning text.
    comment_url: Option<String>,
    /// Truncated mentioning text.
    text_snippet: String,
}

impl From<GithubPrMention> for GraphqlGithubPrMentionMetadata {
    fn from(value: GithubPrMention) -> Self {
        Self {
            common: value.common.into(),
            location: value.location.into(),
            comment_github_id: value.comment_github_id.map(|id| ID(id.to_string())),
            comment_url: value.comment_url,
            text_snippet: value.text_snippet,
        }
    }
}

/// Metadata for a GitHub pull-request review.
#[derive(SimpleObject)]
pub struct GraphqlGithubPrReviewMetadata {
    /// Shared pull-request metadata.
    #[graphql(flatten)]
    common: GraphqlGithubPrNotificationCommon,
    /// Review GitHub identifier.
    review_github_id: Option<ID>,
    /// Public review URL.
    review_url: Option<String>,
    /// Review state.
    state: GraphqlGithubPrReviewState,
    /// Truncated review body.
    review_snippet: Option<String>,
}

impl From<GithubPrReview> for GraphqlGithubPrReviewMetadata {
    fn from(value: GithubPrReview) -> Self {
        Self {
            common: value.common.into(),
            review_github_id: value.review_github_id.map(|id| ID(id.to_string())),
            review_url: value.review_url,
            state: value.state.into(),
            review_snippet: value.review_snippet,
        }
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
            NotifEvent::ChannelMention(metadata) => Self::ChannelMention(metadata.into()),
            NotifEvent::DocumentMention(metadata) => Self::DocumentMention(metadata.into()),
            NotifEvent::MentionedInDocumentComment(metadata) => {
                Self::MentionedInDocumentComment(metadata.into())
            }
            NotifEvent::RepliedToDocumentCommentThread(metadata) => {
                Self::RepliedToDocumentCommentThread(metadata.into())
            }
            NotifEvent::CommentedOnDocument(metadata) => Self::CommentedOnDocument(metadata.into()),
            NotifEvent::ChannelInvite(metadata) => Self::ChannelInvite(metadata.into()),
            NotifEvent::ChannelMessageSend(metadata) => Self::ChannelMessageSend(metadata.into()),
            NotifEvent::ChannelMessageReply(metadata) => Self::ChannelMessageReply(metadata.into()),
            NotifEvent::CallStarted(metadata) => Self::CallStarted(metadata.into()),
            NotifEvent::NewEmail(metadata) => Self::NewEmail(metadata.into()),
            NotifEvent::InboxReauthRequired(metadata) => Self::InboxReauthRequired(metadata.into()),
            NotifEvent::InviteToTeam(metadata) => Self::InviteToTeam(metadata.into()),
            NotifEvent::TaskAssigned(metadata) => Self::TaskAssigned(metadata.into()),
            NotifEvent::Reminder(metadata) => Self::Reminder(metadata.into()),
            NotifEvent::AiResponse(metadata) => Self::AiResponse(metadata.into()),
            NotifEvent::GithubPrStatusChanged(metadata) => {
                Self::GithubPrStatusChanged(metadata.into())
            }
            NotifEvent::GithubPrCheckRun(metadata) => Self::GithubPrCheckRun(metadata.into()),
            NotifEvent::GithubReviewRequested(metadata) => {
                Self::GithubReviewRequested(metadata.into())
            }
            NotifEvent::GithubPrComment(metadata) => Self::GithubPrComment(metadata.into()),
            NotifEvent::GithubPrMention(metadata) => Self::GithubPrMention(metadata.into()),
            NotifEvent::GithubPrReview(metadata) => Self::GithubPrReview(metadata.into()),
        }
    }
}
