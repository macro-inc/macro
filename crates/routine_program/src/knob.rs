//! Knobs: values a code step's owner can change without new code, and the
//! sentence that says what the step does in terms of them.

use std::fmt;

use nom::{
    Finish, IResult, Parser,
    branch::alt,
    bytes::complete::{take_till1, take_while1},
    character::complete::char,
    combinator::{all_consuming, opt},
    multi::many0,
    sequence::delimited,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
mod test;

/// A value a code step reads as `knobs.<name>`, which its owner can change
/// without the step being rewritten: the label it adds, a priority, a
/// number of days, a question it asks AI. Its type is part of the step's
/// type-checked contract; its value is not, so changing it needs no check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineKnob))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Knob {
    /// Free text, such as a label or channel name.
    Text {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// What it is, for the owner, e.g. "Label for money email".
        label: String,
        /// Its value.
        value: String,
    },
    /// A number, optionally bounded.
    Number {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// What it is, for the owner.
        label: String,
        /// Its value.
        value: f64,
        /// The smallest value the owner may set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        min: Option<f64>,
        /// The largest value the owner may set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max: Option<f64>,
    },
    /// On or off.
    Boolean {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// What it is, for the owner.
        label: String,
        /// Its value.
        value: bool,
    },
    /// One of a fixed list of options, such as a priority.
    Choice {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// What it is, for the owner.
        label: String,
        /// The chosen option.
        value: String,
        /// Every option, in the order they are offered.
        options: Vec<String>,
    },
    /// A yes/no question the code asks AI with `macro.ai.decide`, so the
    /// owner can reword what AI decides.
    Question {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// The condition as a short clause that reads inside the step's
        /// sentence, e.g. "it's about money".
        label: String,
        /// The question AI is asked, e.g. "Is this email about money:
        /// investors, fundraising or finance?".
        value: String,
    },
    /// One of the owner's items the code uses, such as the channel it posts
    /// in, which the owner swaps by picking another. The code gets an SDK
    /// handle for it, never its id.
    Entity {
        /// How the code reads it: `knobs.<name>`.
        name: KnobName,
        /// What it is, for the owner, e.g. "Channel to post in".
        label: String,
        /// The kinds of item the owner may pick, at least one, each once.
        entity_types: Vec<EntityKind>,
        /// The item picked; none yet in a starter, which its owner picks
        /// before saving.
        #[serde(default)]
        value: Option<EntityValue>,
    },
}

/// A kind of item an entity knob names: each kind the app's entity picker
/// offers, which Macro's SDK has a handle for, and whole databases. Its
/// name is the SDK's for the kind (`EntityReference`'s `type`, which the
/// handle's `entityType` repeats), except `task`, a document that is a
/// task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineKnobEntityType))]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    /// A channel or direct message.
    Channel,
    /// A document.
    Document,
    /// A folder.
    Project,
    /// A whole database.
    Database,
    /// A person.
    User,
    /// A task: a document that is a task.
    Task,
    /// An email thread.
    EmailThread,
    /// An AI chat.
    Chat,
    /// A CRM company.
    CrmCompany,
    /// A CRM contact.
    CrmContact,
    /// A project: a named group of tasks.
    Initiative,
}

impl EntityKind {
    /// Every kind, in the order the drafter's guide lists them.
    pub const ALL: [Self; 11] = [
        Self::Channel,
        Self::Document,
        Self::Project,
        Self::Database,
        Self::User,
        Self::Task,
        Self::EmailThread,
        Self::Chat,
        Self::CrmCompany,
        Self::CrmContact,
        Self::Initiative,
    ];

    /// The SDK call that gives this kind's handle from its id:
    /// `macro.<namespace>.<method>(id)`. The Deno bootstrap makes the same
    /// calls (`code_execution`'s `bootstrap.mjs`).
    pub fn factory(self) -> (&'static str, &'static str) {
        match self {
            Self::Channel => ("channels", "byId"),
            Self::Document => ("documents", "byId"),
            Self::Project => ("projects", "byId"),
            Self::Database => ("databases", "byId"),
            Self::User => ("users", "byId"),
            Self::Task => ("tasks", "byId"),
            Self::EmailThread => ("email", "byId"),
            Self::Chat => ("chats", "byId"),
            Self::CrmCompany => ("crm", "companyById"),
            Self::CrmContact => ("crm", "contactById"),
            Self::Initiative => ("initiatives", "byId"),
        }
    }

    /// What it is called, for the owner: "channel".
    pub fn noun(self) -> &'static str {
        match self {
            Self::Channel => "channel",
            Self::Document => "document",
            Self::Project => "folder",
            Self::Database => "database",
            Self::User => "person",
            Self::Task => "task",
            Self::EmailThread => "email thread",
            Self::Chat => "chat",
            Self::CrmCompany => "company",
            Self::CrmContact => "contact",
            Self::Initiative => "project",
        }
    }
}

/// The item an entity knob names: its kind and id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineKnobEntity))]
#[serde(deny_unknown_fields)]
pub struct EntityValue {
    /// Its kind.
    #[serde(rename = "type")]
    pub kind: EntityKind,
    /// Its id.
    pub id: EntityId,
}

/// An item's id: not blank, without spaces, at most 256 characters.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineKnobEntityId))]
#[serde(try_from = "String", into = "String")]
pub struct EntityId(String);

impl EntityId {
    /// The id as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for EntityId {
    type Error = InvalidEntityId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let valid = !value.is_empty()
            && value.len() <= 256
            && !value.chars().any(|c| c.is_whitespace() || c.is_control());
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidEntityId)
        }
    }
}

impl From<EntityId> for String {
    fn from(id: EntityId) -> Self {
        id.0
    }
}

/// An entity knob's id that is blank, has spaces or is too long.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("an entity knob's id must be 1 to 256 characters without spaces")]
pub struct InvalidEntityId;

impl Knob {
    /// How the code reads it.
    pub fn name(&self) -> &KnobName {
        match self {
            Self::Text { name, .. }
            | Self::Number { name, .. }
            | Self::Boolean { name, .. }
            | Self::Choice { name, .. }
            | Self::Question { name, .. }
            | Self::Entity { name, .. } => name,
        }
    }

    /// What it is, for the owner.
    pub fn label(&self) -> &str {
        match self {
            Self::Text { label, .. }
            | Self::Number { label, .. }
            | Self::Boolean { label, .. }
            | Self::Choice { label, .. }
            | Self::Question { label, .. }
            | Self::Entity { label, .. } => label,
        }
    }

    /// Its value as the step's sentence shows it: a question by its
    /// clause, on or off as yes or no. None for an entity, whose item's
    /// name this crate doesn't know.
    pub fn sentence_text(&self) -> Option<String> {
        match self {
            Self::Text { value, .. } | Self::Choice { value, .. } => Some(value.clone()),
            Self::Number { value, .. } => Some(value.to_string()),
            Self::Boolean { value, .. } => Some(if *value { "yes" } else { "no" }.to_owned()),
            Self::Question { label, .. } => Some(label.clone()),
            Self::Entity { .. } => None,
        }
    }

    /// Whether it is a question for AI, shown as `{?name}` in a sentence.
    pub fn is_question(&self) -> bool {
        matches!(self, Self::Question { .. })
    }

    /// Its value, as the code receives it.
    pub fn value(&self) -> Value {
        match self {
            Self::Text { value, .. }
            | Self::Choice { value, .. }
            | Self::Question { value, .. } => Value::String(value.clone()),
            Self::Number { value, .. } => serde_json::Number::from_f64(*value)
                .map(Value::Number)
                .unwrap_or(Value::Null),
            Self::Boolean { value, .. } => Value::Bool(*value),
            // The runner turns the marked item into the SDK's handle for it.
            Self::Entity {
                value: Some(value), ..
            } => serde_json::json!({ "$entity": value }),
            Self::Entity { value: None, .. } => Value::Null,
        }
    }

    /// An entity knob's item, if one is picked, and the kinds it allows.
    pub fn entity(&self) -> Option<(Option<&EntityValue>, &[EntityKind])> {
        match self {
            Self::Entity {
                value,
                entity_types,
                ..
            } => Some((value.as_ref(), entity_types)),
            _ => None,
        }
    }

    /// Its TypeScript type in the step's `knobs`. A choice is the union of
    /// its options, so code comparing against an option that doesn't exist
    /// fails the check; an entity is the SDK handle of each kind it allows,
    /// so code calling what a channel doesn't have fails it.
    pub(crate) fn ts_type(&self) -> String {
        match self {
            Self::Text { .. } | Self::Question { .. } => "string".to_owned(),
            Self::Number { .. } => "number".to_owned(),
            Self::Boolean { .. } => "boolean".to_owned(),
            Self::Choice { options, .. } => options
                .iter()
                .map(|option| Value::String(option.clone()).to_string())
                .collect::<Vec<_>>()
                .join(" | "),
            Self::Entity { entity_types, .. } => entity_types
                .iter()
                .map(|kind| {
                    let (namespace, method) = kind.factory();
                    format!("ReturnType<import('@macro-inc/sdk').Macro['{namespace}']['{method}']>")
                })
                .collect::<Vec<_>>()
                .join(" | "),
        }
    }
}

/// How code reads a knob: a lowercase letter, then up to 31 letters or
/// digits, e.g. `dueWithinDays`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct KnobName(String);

impl KnobName {
    /// The name as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for KnobName {
    type Error = InvalidKnobName;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let mut chars = value.chars();
        let valid = value.len() <= 32
            && chars.next().is_some_and(|first| first.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_alphanumeric());
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidKnobName(value))
        }
    }
}

impl From<KnobName> for String {
    fn from(name: KnobName) -> Self {
        name.0
    }
}

impl fmt::Display for KnobName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A knob name that isn't a camelCase identifier.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "knob name `{0}` must be a lowercase letter followed by up to 31 letters or digits, e.g. `dueWithinDays`"
)]
pub struct InvalidKnobName(String);

/// A place in a step's sentence where a knob shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentenceSlot {
    /// The knob, by name.
    pub name: String,
    /// Written `{?name}`: the knob is a question for AI.
    pub question: bool,
}

/// A sentence whose braces don't form `{name}` or `{?name}` slots.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("a step's sentence may only use braces for knobs, as `{{name}}` or `{{?name}}`")]
pub struct SentenceSyntax;

/// A piece of a step's sentence: words, or a knob's slot.
enum SentencePiece<'a> {
    Words(&'a str),
    Slot(SentenceSlot),
}

/// `{name}` or `{?name}`.
fn slot(input: &str) -> IResult<&str, SentenceSlot> {
    delimited(
        char('{'),
        (
            opt(char('?')),
            take_while1(|c: char| c.is_ascii_alphanumeric()),
        ),
        char('}'),
    )
    .map(|(question, name): (Option<char>, &str)| SentenceSlot {
        name: name.to_owned(),
        question: question.is_some(),
    })
    .parse(input)
}

/// `sentence` as words and slots, in order.
fn sentence_pieces(sentence: &str) -> Result<Vec<SentencePiece<'_>>, SentenceSyntax> {
    let piece = alt((
        take_till1(|c| c == '{' || c == '}').map(SentencePiece::Words),
        slot.map(SentencePiece::Slot),
    ));
    all_consuming(many0(piece))
        .parse(sentence)
        .finish()
        .map(|(_, pieces)| pieces)
        .map_err(|_: nom::error::Error<&str>| SentenceSyntax)
}

/// The knob slots in `sentence`, in order.
pub fn sentence_slots(sentence: &str) -> Result<Vec<SentenceSlot>, SentenceSyntax> {
    Ok(sentence_pieces(sentence)?
        .into_iter()
        .filter_map(|piece| match piece {
            SentencePiece::Slot(slot) => Some(slot),
            SentencePiece::Words(_) => None,
        })
        .collect())
}

/// A run of a step's sentence as it reads: words, or a knob's value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SentenceRun {
    /// What it says.
    pub text: String,
    /// It is a knob's value.
    pub knob: bool,
}

/// `sentence` with `knobs`' values in its slots, as runs; none when a slot
/// is malformed, names no knob, or is written the wrong way for its knob
/// (`{?name}` for a question, `{name}` for the rest). Saving refuses those,
/// so this fails only for a step that wasn't saved. None too when a slot
/// shows an entity knob, whose item's name this crate doesn't know.
pub fn sentence_runs(sentence: &str, knobs: &[Knob]) -> Option<Vec<SentenceRun>> {
    sentence_pieces(sentence)
        .ok()?
        .into_iter()
        .map(|piece| match piece {
            SentencePiece::Words(words) => Some(SentenceRun {
                text: words.to_owned(),
                knob: false,
            }),
            SentencePiece::Slot(slot) => knobs
                .iter()
                .find(|knob| knob.name().as_str() == slot.name)
                .filter(|knob| knob.is_question() == slot.question)
                .and_then(|knob| {
                    Some(SentenceRun {
                        text: knob.sentence_text()?,
                        knob: true,
                    })
                }),
        })
        .collect()
}

/// Whether `source` mentions `name` as a whole identifier, as `knobs.name`
/// or a destructured `name` does.
pub(crate) fn mentions(source: &str, name: &str) -> bool {
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '$';
    source.match_indices(name).any(|(at, _)| {
        let before = source[..at].chars().next_back();
        let after = source[at + name.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}
