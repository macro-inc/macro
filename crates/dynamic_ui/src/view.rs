//! The view and its widgets. A field these types do not name is ignored, so a
//! view keeps decoding when the model adds one.

use crate::query::Query;
use nutype::nutype;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A top-level composed view: a flex column of widgets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
pub struct View {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub title: Option<String>,
    pub widgets: Vec<Widget>,
}

/// One block of a view. Layout is order-driven; nesting is achieved with the
/// `container` widget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Widget {
    /// Markdown text: the narrative between the other widgets. Its type is
    /// "md", never "markdown".
    Md { markdown: String },
    /// A chronological sequence of events. Great for "what happened" answers.
    Timeline {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        events: Vec<TimelineEvent>,
    },
    /// A list of workspace items, fetched by a filter query or given as a
    /// fixed set of entity references.
    #[serde(rename_all = "camelCase")]
    List {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        source: ListSource,
        /// Group rows by a facet.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = GroupBy)]
        group_by: Option<GroupBy>,
        /// Cap the number of rows shown.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = u32)]
        limit: Option<u32>,
    },
    /// A single channel message with surrounding context.
    #[serde(rename_all = "camelCase")]
    ChannelMessage {
        /// The channel the message belongs to.
        channel_id: String,
        /// The message to render.
        message_id: String,
    },
    /// A calendar agenda: the events grouped by day with their times, places
    /// and attendees, loaded live from the user's calendars. Use it whenever
    /// an answer is about calendar events instead of listing them in text.
    Events {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        events: Vec<AgendaEvent>,
    },
    /// Rich cards for the one to four specific items the answer is about: a
    /// document or spreadsheet, an email thread, a calendar event, a project,
    /// a channel, a routine, a form or an initiative. Each card opens its
    /// item, and a routine's card can pause it or run it now. Use a list
    /// widget for longer sets.
    Cards {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        items: Vec<CardItem>,
    },
    /// Tags as coloured pills, nested to any depth: the user's tags, a
    /// taxonomy the answer proposes, or any other ontology of tags, each with
    /// what it is for. Use it whenever an answer is about tags, instead of a
    /// table or a list in markdown.
    Tags {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        tags: Vec<TagNode>,
    },
    /// Live cards on which the user answers coding agents' waiting
    /// permission requests and questions, and sees stalled sessions. Pass the
    /// items macro.agentSessions.updates() returned, unchanged, whenever it
    /// returns any: these cards are the only place the user can answer them.
    AgentUpdates { items: Vec<AgentUpdateItem> },
    /// A nestable flex container of widgets.
    Container {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = Direction)]
        direction: Option<Direction>,
        /// Tailwind-ish gap step, 0-8. Defaults to 3.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(with = "Option<u8>", range(max = 8))]
        #[specta(optional, type = Gap)]
        gap: Option<Gap>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = bool)]
        wrap: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = Align)]
        align: Option<Align>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = Justify)]
        justify: Option<Justify>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        children: Vec<Widget>,
    },
}

/// The space between a container's children, as a Tailwind-ish step.
#[nutype(
    validate(less_or_equal = 8),
    derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize),
    derive_unchecked(Type)
)]
pub struct Gap(u8);

/// One event of a timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
pub struct TimelineEvent {
    /// Human-readable timestamp, e.g. "9:32am" or "Yesterday".
    pub time: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub description: Option<String>,
    /// Links the event to a workspace entity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = EntityRef)]
    pub entity: Option<EntityRef>,
    /// true = upcoming/future event, rendered gray; omitted/false = past,
    /// rendered accent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub future: Option<bool>,
}

/// A calendar event an agenda lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgendaEvent {
    /// The eventId a calendar tool such as ListCalendarEvents returned.
    pub event_id: String,
    /// One instance of a recurring event: that instance's recurrenceId from
    /// ListCalendarEvents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub occurrence_key: Option<String>,
}

/// One item of macro.agentSessions.updates(); its other fields are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentUpdateItem {
    pub session: AgentSessionRef,
    pub session_name: String,
    pub harness: String,
    pub kind: AgentUpdateKind,
    pub since: String,
}

/// The session an update is from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
pub struct AgentSessionRef {
    pub id: String,
}

/// What a coding agent's session is waiting for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentUpdateKind {
    Permission,
    Elicitation,
    ToolApproval,
    Stalled,
}

/// A workspace item a card shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
pub struct CardItem {
    #[serde(rename = "type")]
    pub item_type: CardItemType,
    /// The item's id exactly as a tool returned it: a document id (documents
    /// and spreadsheets), an email thread id, a calendar eventId, or a
    /// project, channel, routine, form or initiative id.
    pub id: String,
}

/// The kinds of workspace item a card shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardItemType {
    Document,
    EmailThread,
    CalendarEvent,
    Project,
    Channel,
    Routine,
    Form,
    Initiative,
}

/// One tag of an ontology and the narrower tags under it. A tag may exist
/// already, or be one the answer proposes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct TagNode {
    /// The tag's name. Name a narrower tag on its own: "bug" under "Type",
    /// not "Type/bug".
    pub label: String,
    /// One of the tag colours: red, tomato, orange, amber, yellow, green,
    /// teal, blue, indigo, purple, pink, gray. Gray when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub color: Option<String>,
    /// What the tag is for, in a few words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub description: Option<String>,
    /// For a tag that exists, the id ListTags or CreateTag returned: the tag
    /// then shows its current name and colour, and opens what is tagged with
    /// it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub tag_id: Option<String>,
    /// The narrower tags under this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<TagNode>)]
    pub children: Option<Vec<TagNode>>,
}

/// Where a list's items come from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ListSource {
    /// The items a filter matches, fetched by the list itself.
    Query { query: Box<Query> },
    /// A fixed set of items.
    Items { entities: Vec<EntityRef> },
}

/// A reference to a workspace item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
pub struct EntityRef {
    pub id: String,
    #[serde(rename = "type")]
    pub entity_type: EntityType,
}

/// The kinds of workspace item a view can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    User,
    Chat,
    Channel,
    ChannelMessage,
    Document,
    Project,
    EmailThread,
    CalendarEvent,
    Team,
    Call,
    ForeignEntity,
    StaticFile,
    CrmCompany,
    CrmContact,
    CrmPipeline,
    Reminder,
    Skill,
    AgentSession,
    ScheduledAction,
    Initiative,
    Database,
    DatabaseRow,
    Form,
    ExternalChat,
    Email,
    Routine,
    ChannelThread,
}

/// The facet a list groups its rows by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum GroupBy {
    Date,
    EntityType,
    Project,
}

/// The axis a container lays its children along.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Row,
    Col,
}

/// How a container aligns its children across its axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    Start,
    Center,
    End,
    Stretch,
}

/// How a container spaces its children along its axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum Justify {
    Start,
    Center,
    End,
    Between,
}
