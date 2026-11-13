//! Name lookup: the items, of any kind, the user can access whose name is a
//! given name. Built for resolving the names a request uses ("post in
//! #design-feedback", "tasks in Q4 Launch") to items in one call.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter, EnumString};
use utoipa::ToSchema;
use uuid::Uuid;

/// The most names one request may look up.
pub const MAX_NAMES: usize = 10;

/// The longest name, in characters, one request may look up.
pub const MAX_NAME_CHARS: usize = 200;

/// The most exact matches returned per name.
pub const MAX_EXACT_MATCHES: usize = 10;

/// The most matches returned per name that aren't exact.
pub const MAX_NEAR_MATCHES: usize = 5;

/// A kind of item a name can name.
#[derive(
    Serialize,
    Deserialize,
    Debug,
    ToSchema,
    Copy,
    Clone,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    EnumString,
    Display,
    EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum NameKind {
    /// A channel or direct message the user is a member of.
    Channel,
    /// A person: a teammate or a contact.
    Person,
    /// A folder of documents and other items.
    Project,
    /// An initiative, which the app calls a project.
    Initiative,
    /// A document.
    Document,
    /// A task.
    Task,
    /// A database.
    Database,
    /// An agent.
    Agent,
    /// An email label, in any of the user's inboxes.
    Label,
    /// A tag, from the user's tag set or their team's.
    Tag,
    /// A channel label, the team's or the user's own.
    ChannelLabel,
}

/// One name to look up.
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameQuery {
    /// The name as the request uses it, such as `#design-feedback` or
    /// `Q4 Launch`. Case and one leading `#` or `@` are ignored.
    pub name: String,
    /// The kinds of item to look in; empty looks in every kind.
    #[serde(default)]
    pub kinds: Vec<NameKind>,
}

/// Names to look up, at most [`MAX_NAMES`].
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameSearchRequest {
    /// The names, each looked up on its own.
    pub names: Vec<NameQuery>,
}

/// An item a name matched, by kind.
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NamedItem {
    /// A channel.
    Channel {
        /// The channel's id.
        id: Uuid,
    },
    /// A person.
    Person {
        /// The person's Macro user id.
        id: MacroUserIdStr<'static>,
    },
    /// A folder.
    Project {
        /// The folder's id.
        id: Uuid,
    },
    /// An initiative.
    Initiative {
        /// The initiative's id.
        id: Uuid,
    },
    /// A document.
    Document {
        /// The document's id.
        id: Uuid,
    },
    /// A task.
    Task {
        /// The task's id.
        id: Uuid,
    },
    /// A database.
    Database {
        /// The database's id.
        id: Uuid,
    },
    /// An agent.
    Agent {
        /// The agent's id.
        id: Uuid,
    },
    /// An email label.
    Label {
        /// The label's id.
        id: Uuid,
    },
    /// A tag.
    Tag {
        /// The tag's id, an option of its tag set's property.
        id: Uuid,
        /// The tag set's property definition.
        #[serde(rename = "definitionId")]
        definition_id: Uuid,
    },
    /// A channel label.
    ChannelLabel {
        /// The label's id.
        id: Uuid,
    },
}

impl NamedItem {
    /// The item's kind.
    pub fn kind(&self) -> NameKind {
        match self {
            Self::Channel { .. } => NameKind::Channel,
            Self::Person { .. } => NameKind::Person,
            Self::Project { .. } => NameKind::Project,
            Self::Initiative { .. } => NameKind::Initiative,
            Self::Document { .. } => NameKind::Document,
            Self::Task { .. } => NameKind::Task,
            Self::Database { .. } => NameKind::Database,
            Self::Agent { .. } => NameKind::Agent,
            Self::Label { .. } => NameKind::Label,
            Self::Tag { .. } => NameKind::Tag,
            Self::ChannelLabel { .. } => NameKind::ChannelLabel,
        }
    }
}

/// An item a name matched.
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameMatch {
    /// The item's name as stored.
    pub name: String,
    /// Whether its name is the name looked up, ignoring case, surrounding
    /// space and one leading `#` or `@`. For a person, their full name, first
    /// name or email address counts.
    pub exact: bool,
    /// The item.
    pub item: NamedItem,
}

/// What one name matched.
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameResult {
    /// The name as it was asked for.
    pub name: String,
    /// At most [`MAX_EXACT_MATCHES`] exact matches first, then at most
    /// [`MAX_NEAR_MATCHES`] items whose name contains it, those starting with
    /// it first.
    pub matches: Vec<NameMatch>,
}

/// What each name matched, in the order asked.
#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameSearchResponse {
    /// One result per name asked for.
    pub results: Vec<NameResult>,
    /// The kinds that couldn't be looked in this time. A name that matched
    /// nothing may still name an item of one of these kinds.
    pub unavailable: Vec<NameKind>,
}
