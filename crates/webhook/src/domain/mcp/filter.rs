//! The filter language an MCP event subscription is compiled into.
//!
//! A natural-language request ("all @ mentions of me in channels") is turned
//! into an [`McpEventFilter`] once, when the subscription is made; delivery
//! then evaluates it deterministically against each event's payload. The
//! language is deliberately small: a filter is an OR of clauses, and a clause
//! is exact Macro event names, optional parent entity ids (the webhook `ids`
//! semantics), and an AND of conditions that each require one whitelisted
//! payload field to equal one of a few values. Whatever does not fit is
//! refused when the filter is compiled, never approximated.

#[cfg(test)]
#[path = "filter_test.rs"]
mod test;

use crate::domain::mcp::models::MAX_FILTER_BYTES;
use crate::domain::models::{WEBHOOK_EVENT_NAMES, WebhookFilter};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Most clauses one filter may hold.
pub const MAX_CLAUSES: usize = 8;
/// Most conditions one clause may hold.
pub const MAX_CONDITIONS: usize = 4;
/// Most values one condition may accept, and most ids one clause may name.
pub const MAX_VALUES: usize = 16;
/// Longest value or id, in bytes.
pub const MAX_VALUE_LEN: usize = 256;

const MESSAGE_EVENT_PREFIX: &str = "message.";
const MESSAGE_MENTIONED: &str = "message.mentioned";
const MESSAGE_POSTED: &str = "message.posted";

/// A compiled subscription filter: an event matches when any clause does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct McpEventFilter {
    /// Alternatives; at least one, at most [`MAX_CLAUSES`].
    pub any_of: Vec<McpFilterClause>,
}

/// One alternative: every part must hold.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct McpFilterClause {
    /// Exact Macro event names, as the webhooks name them.
    pub events: Vec<String>,
    /// Parent entity ids, as a webhook filter's `ids`: a document's id for
    /// document events, a channel's for channel events, and the message's
    /// parent (channel or document) for message events. Absent means any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    /// Payload conditions, all of which must hold.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub all_of: Vec<McpFieldCondition>,
}

/// A payload field that must equal one of `one_of`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub struct McpFieldCondition {
    /// The field compared.
    pub field: McpFilterField,
    /// Accepted values; at least one.
    pub one_of: Vec<McpFilterValue>,
}

/// The payload fields a condition can compare. Each applies to message
/// events only, and the mention fields to `message.mentioned` only.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum McpFilterField {
    /// Where the message lives: `channel`, `document`, `initiative`,
    /// `crm_company`, `crm_contact` or `call`.
    ParentType,
    /// The id of the channel, document or other entity the message lives in.
    ParentId,
    /// Who posted, edited, deleted or attached: `macro|<email>` for a user,
    /// `bot|<uuid>` for a bot.
    Actor,
    /// What was mentioned: `user`, `bot`, `document`, …
    MentionedType,
    /// The id of what was mentioned (`macro|<email>` for a user).
    MentionedId,
}

impl McpFilterField {
    /// Whether events named `event` carry this field.
    #[must_use]
    pub fn applies_to(self, event: &str) -> bool {
        match self {
            Self::ParentType | Self::ParentId | Self::Actor => {
                event.starts_with(MESSAGE_EVENT_PREFIX)
            }
            Self::MentionedType | Self::MentionedId => event == MESSAGE_MENTIONED,
        }
    }

    /// The field's value in a broker envelope of an event named `event`.
    fn value<'a>(self, event: &str, envelope: &'a serde_json::Value) -> Option<&'a str> {
        let pointer = match self {
            Self::ParentType => "/metadata/parent/type",
            Self::ParentId => "/metadata/parent/id",
            // Posts and mentions name their author `sender`; every other
            // message fact names whoever acted `actor`.
            Self::Actor if event == MESSAGE_POSTED || event == MESSAGE_MENTIONED => {
                "/metadata/sender"
            }
            Self::Actor => "/metadata/actor",
            Self::MentionedType => "/metadata/mentioned/entity_type",
            Self::MentionedId => "/metadata/mentioned/entity_id",
        };
        envelope.pointer(pointer)?.as_str()
    }
}

/// A value a condition accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "json-schema", derive(schemars::JsonSchema))]
pub enum McpFilterValue {
    /// Exactly this text.
    Literal {
        /// The text.
        value: String,
    },
    /// The subscriber's own Macro user id (`macro|<email>`).
    Me,
}

/// Why a filter was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum McpFilterError {
    /// No clauses, or more than [`MAX_CLAUSES`].
    #[error("a filter needs 1 to {MAX_CLAUSES} alternatives")]
    ClauseCount,
    /// A clause names no events.
    #[error("every alternative must name at least one event")]
    NoEvents,
    /// A clause names an event Macro does not emit.
    #[error("unknown event `{0}`")]
    UnknownEvent(String),
    /// Too many conditions in a clause.
    #[error("an alternative holds at most {MAX_CONDITIONS} conditions")]
    ConditionCount,
    /// A condition, or a clause's `ids`, holds no values, or too many.
    #[error("a condition or id list holds 1 to {MAX_VALUES} values")]
    ValueCount,
    /// A value or id is blank, too long, or holds a NUL character (which
    /// PostgreSQL cannot store in `jsonb`).
    #[error("values and ids are 1 to {MAX_VALUE_LEN} bytes, not blank, with no NUL character")]
    ValueLength,
    /// The filter is over [`MAX_FILTER_BYTES`] of JSON.
    #[error("a filter is at most {MAX_FILTER_BYTES} bytes of JSON")]
    TooLarge,
    /// A condition compares a field an event of its clause does not carry.
    #[error("`{field}` does not apply to `{event}`")]
    FieldNotApplicable {
        /// The field.
        field: McpFilterField,
        /// The event without it.
        event: String,
    },
}

impl McpEventFilter {
    /// The filter a plain webhook-style subscription makes: these events,
    /// optionally only for these parent ids.
    #[must_use]
    pub fn for_events(events: Vec<String>, ids: Option<Vec<String>>) -> Self {
        Self {
            any_of: vec![McpFilterClause {
                events,
                ids,
                all_of: Vec::new(),
            }],
        }
    }

    /// Check the filter is one delivery can evaluate, within the limits.
    pub fn validate(&self) -> Result<(), McpFilterError> {
        if self.any_of.is_empty() || self.any_of.len() > MAX_CLAUSES {
            return Err(McpFilterError::ClauseCount);
        }
        self.any_of.iter().try_for_each(McpFilterClause::validate)?;
        if serde_json::to_vec(self).map_or(true, |bytes| bytes.len() > MAX_FILTER_BYTES) {
            return Err(McpFilterError::TooLarge);
        }
        Ok(())
    }

    /// Every event name some clause can match, sorted and deduplicated.
    #[must_use]
    pub fn event_names(&self) -> Vec<String> {
        self.any_of
            .iter()
            .flat_map(|clause| clause.events.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The filter split for a source that narrows by event name and parent
    /// id but does not report the parent id of what it sends (the live event
    /// stream): one group per distinct `ids` among the clauses. Open one
    /// source per group with its [`McpStreamGroup::source`], match what it
    /// sends with the group's [`McpStreamGroup::filter`] (ids already
    /// applied), and drop events another group already delivered.
    #[must_use]
    pub fn stream_groups(&self) -> Vec<McpStreamGroup> {
        let mut groups: Vec<(Option<Vec<String>>, Vec<McpFilterClause>)> = Vec::new();
        for clause in &self.any_of {
            let ids = clause.ids.as_ref().map(|ids| {
                ids.iter()
                    .cloned()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>()
            });
            let without_ids = McpFilterClause {
                ids: None,
                ..clause.clone()
            };
            match groups.iter_mut().find(|(group_ids, _)| *group_ids == ids) {
                Some((_, clauses)) => clauses.push(without_ids),
                None => groups.push((ids, vec![without_ids])),
            }
        }
        groups
            .into_iter()
            .map(|(ids, clauses)| {
                let filter = Self { any_of: clauses };
                McpStreamGroup {
                    source: WebhookFilter {
                        events: filter.event_names(),
                        ids,
                    },
                    filter,
                }
            })
            .collect()
    }

    /// Whether an event matches, for the subscriber `me`.
    ///
    /// `envelope` is the broker envelope webhooks deliver; `entity_id` is the
    /// event's matching entity (the webhook `ids` subject).
    #[must_use]
    pub fn matches(
        &self,
        event: &str,
        entity_id: &str,
        envelope: &serde_json::Value,
        me: &str,
    ) -> bool {
        self.any_of
            .iter()
            .any(|clause| clause.matches(event, entity_id, envelope, me))
    }
}

impl McpFilterClause {
    fn validate(&self) -> Result<(), McpFilterError> {
        if self.events.is_empty() {
            return Err(McpFilterError::NoEvents);
        }
        if let Some(unknown) = self
            .events
            .iter()
            .find(|event| !WEBHOOK_EVENT_NAMES.contains(&event.as_str()))
        {
            return Err(McpFilterError::UnknownEvent(unknown.clone()));
        }
        if let Some(ids) = &self.ids {
            check_values(ids.iter().map(String::as_str), ids.len())?;
        }
        if self.all_of.len() > MAX_CONDITIONS {
            return Err(McpFilterError::ConditionCount);
        }
        for condition in &self.all_of {
            let literals = condition.one_of.iter().filter_map(|value| match value {
                McpFilterValue::Literal { value } => Some(value.as_str()),
                McpFilterValue::Me => None,
            });
            check_values(literals, condition.one_of.len())?;
            if let Some(event) = self
                .events
                .iter()
                .find(|event| !condition.field.applies_to(event))
            {
                return Err(McpFilterError::FieldNotApplicable {
                    field: condition.field,
                    event: event.clone(),
                });
            }
        }
        Ok(())
    }

    fn matches(
        &self,
        event: &str,
        entity_id: &str,
        envelope: &serde_json::Value,
        me: &str,
    ) -> bool {
        self.events.iter().any(|name| name == event)
            && self
                .ids
                .as_ref()
                .is_none_or(|ids| ids.iter().any(|id| id == entity_id))
            && self.all_of.iter().all(|condition| {
                condition
                    .field
                    .value(event, envelope)
                    .is_some_and(|actual| {
                        condition.one_of.iter().any(|accepted| match accepted {
                            McpFilterValue::Literal { value } => value == actual,
                            McpFilterValue::Me => me == actual,
                        })
                    })
            })
    }
}

fn check_values<'a>(
    mut literals: impl Iterator<Item = &'a str>,
    count: usize,
) -> Result<(), McpFilterError> {
    if count == 0 || count > MAX_VALUES {
        return Err(McpFilterError::ValueCount);
    }
    if literals
        .any(|value| value.trim().is_empty() || value.len() > MAX_VALUE_LEN || value.contains('\0'))
    {
        return Err(McpFilterError::ValueLength);
    }
    Ok(())
}

/// One source of a streamed subscription; see
/// [`McpEventFilter::stream_groups`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpStreamGroup {
    /// What to ask the source for: these events, for these parent ids.
    pub source: WebhookFilter,
    /// What the source's events must also match; it names no ids, since the
    /// source applied them.
    pub filter: McpEventFilter,
}
