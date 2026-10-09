//! Why an agent was called, and what about.
//!
//! One [`TriggerContext`] travels on each trigger event. Whoever delivers the
//! prompt has lexical-service render it as XML ahead of the user's text, so
//! every runtime sees the same account of the trigger. Everything here is
//! untrusted context read under the triggering user's access: it describes the
//! request, and grants nothing.

use bot_id::BotId;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// What happened to call the agent, and everything it needs to know about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TriggerContext {
    /// A mention opened the session.
    Mentioned(DiscussionContext),
    /// A further message in the discussion of a session that is already running.
    FollowUp(FollowUpContext),
    /// The agent was assigned a task.
    TaskAssigned(TaskAssignedContext),
    /// Someone opened the session from the composer. Their prompt arrives
    /// separately, through the session itself.
    Requested(RequestedContext),
    /// Another agent handed this one a task.
    Dispatched(DispatchedContext),
    /// A routine fired.
    Routine(RoutineContext),
}

/// What kind of channel a discussion is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    /// Anyone in the organization can join.
    Public,
    /// Invited members only.
    Private,
    /// A conversation between two people.
    DirectMessage,
    /// A team's channel.
    Team,
}

/// A person or bot, as a reader would name them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextPerson {
    /// Stable identity: a Macro user id or a bot id.
    pub id: String,
    /// Display name, or the email when the user set none.
    pub name: String,
    /// Absent for bots and imported authors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// A message the agent may read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextMessage {
    /// Message id.
    pub id: Uuid,
    /// Who wrote it.
    pub author: ContextPerson,
    /// Body, in internal markdown.
    pub content: String,
    /// When it was posted.
    pub posted_at: DateTime<Utc>,
}

/// Messages of one discussion, oldest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextThread {
    /// Root message of the discussion.
    pub root_id: Uuid,
    /// Live messages, the root first when it is included.
    pub messages: Vec<ContextMessage>,
    /// Whether some messages of the discussion were left out.
    pub messages_omitted: bool,
}

/// The discussion a message was posted in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscussionContext {
    /// Where the discussion lives.
    pub surface: DiscussionSurface,
    /// The message that called the agent.
    pub prompt_message_id: Uuid,
    /// Who posted it.
    pub sender: ContextPerson,
    /// What the message answers.
    pub reply_target: ReplyTarget,
    /// The message's own discussion, from its root through the message.
    /// Absent for a top-level channel message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<ContextThread>,
    /// Other recent channel activity, grouped by discussion, oldest first.
    /// For a top-level channel message this is the primary context and ends
    /// with the message. Empty off channels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel: Vec<ContextThread>,
}

/// Where a discussion lives. Each carries its name, so the agent is never
/// handed a bare id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DiscussionSurface {
    /// A channel.
    Channel {
        /// Channel id.
        id: Uuid,
        /// Channel name; direct messages have none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        /// Public, private, direct message, or team.
        channel_type: ChannelType,
    },
    /// A comment thread on a document.
    DocumentComment {
        /// Document id.
        id: String,
        /// Document name.
        name: String,
        /// Where in the document the thread sits, when it is anchored.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<CommentAnchor>,
    },
    /// A comment thread on a project.
    ProjectComment {
        /// Project id.
        id: Uuid,
        /// Project name.
        name: String,
    },
    /// A comment thread on a CRM company.
    CrmCompanyComment {
        /// Company id.
        id: Uuid,
        /// Company name.
        name: String,
    },
    /// A comment thread on a CRM contact.
    CrmContactComment {
        /// Contact id.
        id: Uuid,
        /// Contact name.
        name: String,
    },
    /// The chat of a call.
    CallChat {
        /// Call id.
        id: Uuid,
        /// Call title.
        title: String,
    },
}

/// What a message answers. Without this the agent has to guess which of the
/// surrounding messages "fix this" means.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReplyTarget {
    /// The author quote-replied to one message.
    Quote {
        /// The quoted message.
        message_id: Uuid,
        /// The discussion holding the quoted message.
        thread_id: Uuid,
        /// The one-line preview the quote renders.
        preview: String,
        /// The quoted message in full. Absent when it lives in another
        /// conversation or could not be read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<ContextMessage>,
    },
    /// The message was posted as a reply in a discussion.
    Thread {
        /// Root of that discussion.
        root_id: Uuid,
    },
    /// The message was posted at the top level of a channel and replies to
    /// no particular message.
    None,
}

/// Where in a document a comment thread sits. An annotation id alone names a
/// location the agent has no way to resolve, so the text it covers travels
/// with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommentAnchor {
    /// A cell or rectangular range in a native spreadsheet.
    Spreadsheet {
        /// Stable sheet identity within the workbook.
        sheet_id: String,
        /// Sheet name when the discussion was created.
        sheet_name: String,
        /// A1 cell or range, such as B4 or B4:C9.
        range: String,
    },
    /// A comment mark in a markdown document.
    Mark {
        /// Lexical mark the thread is attached to.
        mark_id: String,
        /// The marked text as it read when the comment was posted. Absent on
        /// threads anchored before snapshots were captured.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked_text: Option<String>,
        /// The mark as the document reads now. Absent when the document no
        /// longer carries it or the lookup failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        current: Option<MarkedPassage>,
    },
    /// A highlight on a PDF.
    PdfHighlight {
        /// Highlight annotation the thread is attached to.
        anchor_id: String,
        /// The text the highlight covers. Absent when the highlight carries none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        marked_text: Option<String>,
    },
    /// A point pinned on a PDF page, which covers no text.
    PdfPin {
        /// Pin annotation the thread is attached to.
        anchor_id: String,
    },
}

/// A comment mark resolved against the live document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkedPassage {
    /// The text the mark covers.
    pub marked_text: String,
    /// The block or blocks containing the mark, windowed around it.
    pub surrounding_text: String,
}

/// A message for a session that is already running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FollowUpContext {
    /// How the message reached this agent.
    pub addressed_by: AddressedBy,
    /// The discussion it was posted in.
    pub discussion: DiscussionContext,
}

/// How a follow-up was attributed to the agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddressedBy {
    /// The message mentions the agent.
    Mention,
    /// The message quote-replies to the agent, without a mention.
    ExplicitReply,
    /// A model judged the message was meant for the agent.
    Inferred,
}

/// A task handed to the agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskAssignedContext {
    /// The task as it reads now.
    pub task: TaskSnapshot,
    /// Who assigned it.
    pub assigned_by: ContextPerson,
    /// When.
    pub assigned_at: DateTime<Utc>,
    /// The agent's own discussion on the task, where it answers.
    pub discussion_id: Uuid,
}

/// A task, read under the assigner's access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSnapshot {
    /// Task id.
    pub id: String,
    /// Title.
    pub title: String,
    /// Description, in internal markdown.
    pub markdown: String,
    /// Status option name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Priority option name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    /// Due date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<DateTime<Utc>>,
    /// Everyone assigned, people and agents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assignees: Vec<ContextPerson>,
    /// The task's project, only when the assigner can see it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectRef>,
}

/// A project, by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRef {
    /// Project id.
    pub id: Uuid,
    /// Project name.
    pub name: String,
}

/// A session opened from the composer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestedContext {
    /// Who opened it.
    pub requested_by: ContextPerson,
    /// When.
    pub requested_at: DateTime<Utc>,
    /// Repository the requester picked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
}

/// A task handed over by another agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DispatchedContext {
    /// The user whose authority the work runs under.
    pub dispatched_by: ContextPerson,
    /// When.
    pub dispatched_at: DateTime<Utc>,
    /// The agent that handed it over.
    pub from_bot: Option<BotId>,
    /// The session that handed it over, when it was one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_session: Option<Uuid>,
    /// Repository chosen for the work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
}

/// A routine run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutineContext {
    /// The routine's id.
    pub routine_id: Uuid,
    /// The routine's name.
    pub name: String,
    /// Whose routine it is.
    pub owner: ContextPerson,
    /// What the routine asks for, as its owner wrote it.
    pub instructions: String,
    /// Everything that makes it run.
    pub triggers: Vec<RoutineTrigger>,
    /// What made it fire this time.
    pub firing: RoutineFiring,
}

/// One of the ways a routine runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineTrigger {
    /// A cron schedule.
    Schedule {
        /// The cron expression.
        cron: String,
        /// The timezone it is read in.
        timezone: String,
    },
    /// Events it watches.
    Events {
        /// The event names, such as `email.message_received`.
        events: Vec<String>,
        /// Only these entities, when the routine narrows to some.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        entity_ids: Vec<Uuid>,
        /// A yes/no question the event's content must answer yes to.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        condition: Option<String>,
    },
}

/// What made a routine fire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RoutineFiring {
    /// Its schedule came due.
    Scheduled {
        /// When the run was due.
        scheduled_for: DateTime<Utc>,
        /// The schedule, as the routine states it.
        schedule: String,
    },
    /// Its owner started it by hand.
    Manual {
        /// When they started it.
        requested_at: DateTime<Utc>,
    },
    /// An event it watches happened.
    Event {
        /// The event. Boxed: it carries whole discussions and documents.
        event: Box<RoutineEvent>,
        /// The routine's yes/no questions this event was checked against;
        /// it answered yes to at least one. Empty when the routine asks none.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        conditions: Vec<String>,
    },
}

/// The event a routine fired on, one variant per event it can watch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum RoutineEvent {
    /// A document was created.
    DocumentCreated {
        /// The document.
        document: DocumentSnapshot,
    },
    /// A document was edited.
    DocumentUpdated {
        /// The document as it reads now.
        document: DocumentSnapshot,
    },
    /// A document was deleted.
    DocumentDeleted {
        /// Document id.
        id: String,
        /// Its name.
        name: String,
    },
    /// A task was created.
    TaskCreated {
        /// The task.
        task: TaskSnapshot,
    },
    /// A task's status changed.
    TaskStatusChanged {
        /// The task as it reads now.
        task: TaskSnapshot,
    },
    /// A task's priority changed.
    TaskPriorityChanged {
        /// The task as it reads now.
        task: TaskSnapshot,
    },
    /// Another of a task's properties changed. The event does not record
    /// which one.
    TaskPropertyChanged {
        /// The task as it reads now.
        task: TaskSnapshot,
    },
    /// An email arrived.
    EmailReceived {
        /// The email.
        email: EmailSnapshot,
    },
    /// A channel was created.
    ChannelCreated {
        /// Channel id.
        id: Uuid,
        /// Channel name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// A message was posted in a channel.
    ChannelMessagePosted {
        /// The discussion it was posted in.
        discussion: DiscussionContext,
    },
    /// Someone was mentioned in a channel.
    ChannelMentioned {
        /// The discussion the mention was posted in.
        discussion: DiscussionContext,
    },
    /// A channel message was edited.
    ChannelMessagePatched {
        /// The discussion, with the message as it reads now.
        discussion: DiscussionContext,
    },
    /// Something was attached to a channel message.
    ChannelMessageAttachmentCreated {
        /// The discussion holding the message.
        discussion: DiscussionContext,
        /// What was attached, such as a document.
        entity_type: String,
        /// Its id.
        entity_id: String,
    },
}

/// A document, read under the routine owner's access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentSnapshot {
    /// Document id.
    pub id: String,
    /// Name.
    pub name: String,
    /// File type, such as md or pdf.
    pub file_type: String,
    /// Text content, bounded. Absent for documents with no readable text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// An email, read under the routine owner's access.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailSnapshot {
    /// Thread id.
    pub thread_id: Uuid,
    /// Subject line.
    pub subject: String,
    /// Sender, as the email names them.
    pub from: String,
    /// Recipients.
    pub to: Vec<String>,
    /// When it arrived.
    pub received_at: DateTime<Utc>,
    /// Body as plain text, bounded.
    pub body: String,
}
