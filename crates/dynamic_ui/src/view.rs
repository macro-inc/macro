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
    /// Static markdown, the narrative glue between data widgets. Supports the
    /// full markdown feature set (headings, lists, bold/italic, links,
    /// blockquotes, ...).
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

/// Where a list's items come from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ListSource {
    /// The items a filter matches, fetched by the list itself.
    Query { query: Query },
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
