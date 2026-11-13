//! Notification stacks and the rules they route by.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::ChannelType;
use notification::domain::models::NotificationLane;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The most stacks one person can have.
pub const MAX_STACKS: usize = 50;
/// The most rules in a stack's capture list or its release list.
pub const MAX_RULES: usize = 32;
/// The most values one condition of a rule can list.
pub const MAX_CONDITION_VALUES: usize = 100;
/// The longest stack name, channel name text or item id, in characters.
pub const MAX_TEXT_LENGTH: usize = 200;

/// The feature flag that turns notification stacks on for a person. The web
/// app reads the same key.
pub const NOTIFICATION_STACKS_FLAG: &str = "enable-notification-stacks";

/// A person's stack: it captures the notifications its capture rules match
/// and files them in its lane, except those its release rules let through.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct NotificationStack {
    /// The stack's id.
    pub id: Uuid,
    /// The name its owner gave it.
    pub name: String,
    /// Where it sits among its owner's stacks. Stacks are tried in this
    /// order and the first whose capture rules match takes the notification.
    pub position: i32,
    /// The lane a captured notification is filed in.
    pub lane: NotificationLane,
    /// A notification any of these rules matches is captured.
    pub capture: Vec<StackRule>,
    /// A captured notification any of these rules matches is let through
    /// and delivered as usual.
    pub release: Vec<StackRule>,
    /// Whether the stack routes anything.
    pub enabled: bool,
    /// Counts its edits. A routed notification records the revision that
    /// routed it.
    pub revision: i32,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When it was last edited.
    pub updated_at: DateTime<Utc>,
}

/// One rule. It matches a notification when every condition it sets holds.
/// A condition is set when its list has a value, and holds when any of its
/// values matches.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(as = NotificationStackRule))]
#[serde(rename_all = "camelCase")]
pub struct StackRule {
    /// Where the notification happened.
    #[serde(default)]
    pub sources: Vec<StackSource>,
    /// The type of the channel it happened in.
    #[serde(default)]
    pub channel_types: Vec<ChannelType>,
    /// What kind of notification it is.
    #[serde(default)]
    pub kinds: Vec<StackKind>,
    /// The person who caused it. A bot or an agent is never a sender.
    #[serde(default)]
    #[cfg_attr(feature = "inbound", schema(value_type = Vec<String>))]
    pub senders: Vec<MacroUserIdStr<'static>>,
}

impl StackRule {
    /// Whether the rule sets any condition. A rule that sets none would match
    /// every notification.
    pub fn sets_a_condition(&self) -> bool {
        !(self.sources.is_empty()
            && self.channel_types.is_empty()
            && self.kinds.is_empty()
            && self.senders.is_empty())
    }
}

/// A place a rule matches notifications from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(as = NotificationStackSource))]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StackSource {
    /// One channel.
    Channel {
        /// The channel's id.
        id: String,
    },
    /// Every channel whose name contains the text, ignoring case. A direct
    /// message never matches: its name depends on who reads it.
    ChannelNameContains {
        /// The text to find in the channel's name.
        text: String,
    },
    /// One document or task: the comments on it.
    Document {
        /// The document's id.
        id: String,
    },
    /// Every document and task filed in a folder or in a folder below it.
    Folder {
        /// The folder's id.
        id: String,
    },
    /// A task project: its discussion and the tasks in it.
    Project {
        /// The project's id.
        id: String,
    },
}

/// What kind of notification a rule matches, whichever place it happened in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(as = NotificationStackKind))]
#[serde(rename_all = "camelCase")]
pub enum StackKind {
    /// The recipient was mentioned, in a channel message or a comment.
    Mention,
    /// A reply in a thread the recipient is part of. A reply notification
    /// only goes to the thread's participants, so this is "replies in my
    /// threads".
    Reply,
    /// A new top-level message in a channel.
    NewMessage,
    /// A reaction to one of the recipient's messages.
    Reaction,
    /// A document mentioned in a channel message.
    DocumentMention,
    /// A comment on something the recipient owns or is assigned to.
    Comment,
}

/// A new stack as its owner writes it. It captures into the noise lane.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(as = NewNotificationStack))]
#[serde(rename_all = "camelCase")]
pub struct NewStack {
    /// The stack's name.
    pub name: String,
    /// The capture rules. At least one.
    pub capture: Vec<StackRule>,
    /// The release rules.
    #[serde(default)]
    pub release: Vec<StackRule>,
}

/// Changes to a stack. A field left out keeps its value.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(as = NotificationStackChanges))]
#[serde(rename_all = "camelCase")]
pub struct StackChanges {
    /// A new name.
    pub name: Option<String>,
    /// New capture rules, replacing the old ones.
    pub capture: Option<Vec<StackRule>>,
    /// New release rules, replacing the old ones.
    pub release: Option<Vec<StackRule>>,
    /// Whether the stack routes anything.
    pub enabled: Option<bool>,
}

/// Why a notification was routed the way it was, stored on the recipient's
/// row as `user_notification.routing`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRecord {
    /// The stack whose capture rules matched.
    pub stack_id: Uuid,
    /// The stack's revision when it routed the notification.
    pub stack_revision: i32,
    /// What the stack did with it.
    pub outcome: RoutingOutcome,
    /// The index of the capture rule that matched.
    pub capture_rule: usize,
    /// The index of the release rule that let it through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_rule: Option<usize>,
}

/// What a stack did with a notification its capture rules matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutingOutcome {
    /// Filed in the stack's lane, with no alert.
    Captured,
    /// Let through by a release rule and delivered as usual.
    Released,
}

/// Why a stack was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InvalidStack {
    /// The name is empty.
    #[error("a stack needs a name")]
    NameMissing,
    /// A name, channel name text or id is longer than [`MAX_TEXT_LENGTH`].
    #[error("a name, channel name text or id is longer than {MAX_TEXT_LENGTH} characters")]
    TextTooLong,
    /// There is no capture rule.
    #[error("a stack needs at least one capture rule")]
    NoCaptureRule,
    /// A list of rules is longer than [`MAX_RULES`].
    #[error("a stack takes at most {MAX_RULES} capture rules and {MAX_RULES} release rules")]
    TooManyRules,
    /// A rule sets no condition.
    #[error("a rule must set at least one condition")]
    RuleWithoutCondition,
    /// A condition lists more than [`MAX_CONDITION_VALUES`] values.
    #[error("a condition takes at most {MAX_CONDITION_VALUES} values")]
    TooManyValues,
    /// A source has an empty id or empty channel name text.
    #[error("a source needs an id or some channel name text")]
    SourceEmpty,
    /// The owner already has [`MAX_STACKS`] stacks.
    #[error("you can have at most {MAX_STACKS} stacks")]
    TooManyStacks,
    /// A new order does not name each of the owner's stacks exactly once.
    #[error("the order must name each of your stacks once")]
    OrderMismatch,
}

/// A failed stack operation.
#[derive(Debug, thiserror::Error)]
pub enum StackError {
    /// Notification stacks are not turned on for the caller.
    #[error("notification stacks are not available")]
    Unavailable,
    /// The stack does not exist among the caller's stacks.
    #[error("stack not found")]
    NotFound,
    /// The stack as written is not allowed.
    #[error(transparent)]
    Invalid(#[from] InvalidStack),
    /// Any other failure.
    #[error("internal notification stack error: {0:?}")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for StackError {
    fn from(report: rootcause::Report) -> Self {
        StackError::Internal(report)
    }
}
