//! Topics: what suggestions are grouped under in For you. Generation sessions
//! name them and give them to suggestions; the server never groups, scores or
//! words them itself.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use super::model::{Suggestion, Target};

#[cfg(test)]
mod test;

/// A topic, as a suggestion names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TopicName {
    /// Names the topic across nights.
    pub key: String,
    /// What it is, in a few words.
    pub name: String,
}

/// Why a topic matters now: one fact, and the item it was read in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TopicReason {
    /// The fact, in one line.
    pub text: String,
    /// The item that states it: whoever can't open it isn't shown the fact.
    pub source: Target,
}

/// One result in the person's work that several suggestions end at, such as
/// a renewal, an event or a filled role, as generation sessions named it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    /// Names the topic across nights.
    pub key: String,
    /// What it is, in a few words.
    pub name: String,
    /// Why it matters now, when an item says.
    pub reason: Option<TopicReason>,
    /// How many of the listed suggestions are open and belong to it.
    pub open: u32,
}

/// A topic as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTopic {
    /// Names the topic across nights.
    pub key: String,
    /// What it is, in a few words.
    pub name: String,
    /// Why it mattered when it was last named.
    pub reason: Option<TopicReason>,
    /// When it was last named.
    pub updated_at: DateTime<Utc>,
    /// When one of its suggestions last became done or was resolved.
    pub settled_at: Option<DateTime<Utc>>,
}

impl StoredTopic {
    /// Whether one of its suggestions settled since it was last named: its
    /// reason may be about what is now over, and the next generation writes a
    /// new one.
    pub fn settled_since_named(&self) -> bool {
        self.settled_at
            .is_some_and(|settled| settled > self.updated_at)
    }
}

/// What a write does with a suggestion's topic: nothing when the field is left
/// out, none when it is null, else the topic with that key.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum TopicChange {
    /// It keeps the one it has, or none.
    #[default]
    Keep,
    /// It has none.
    Clear,
    /// It has the topic with this key.
    To(String),
}

impl<'de> Deserialize<'de> for TopicChange {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Option::deserialize(deserializer)?.map_or(Self::Clear, Self::To))
    }
}

/// The topics of `suggestions`, in the order they first appear there, as
/// `stored`.
pub fn topics_of(suggestions: &[Suggestion], stored: &[StoredTopic]) -> Vec<Topic> {
    let mut topics: Vec<Topic> = Vec::new();
    for suggestion in suggestions {
        let Some(key) = suggestion.topic.as_ref().map(|topic| &topic.key) else {
            continue;
        };
        let open = u32::from(suggestion.state.is_open());
        if let Some(topic) = topics.iter_mut().find(|topic| topic.key == *key) {
            topic.open += open;
            continue;
        }
        let Some(stored) = stored.iter().find(|topic| topic.key == *key) else {
            continue;
        };
        topics.push(Topic {
            key: stored.key.clone(),
            name: stored.name.clone(),
            reason: stored.reason.clone(),
            open,
        });
    }
    topics
}

/// Gives each of `suggestions` its topic's name from `topics`, which were read
/// after it: a topic renamed in between reads the same in both.
pub fn name_topics_from(topics: &[Topic], suggestions: &mut [Suggestion]) {
    for topic in suggestions
        .iter_mut()
        .filter_map(|suggestion| suggestion.topic.as_mut())
    {
        if let Some(read) = topics.iter().find(|read| read.key == topic.key) {
            topic.name.clone_from(&read.name);
        }
    }
}

/// The keys of the topics `suggestions` belong to, each once.
pub fn topic_keys<'a>(suggestions: impl IntoIterator<Item = &'a Suggestion>) -> HashSet<String> {
    suggestions
        .into_iter()
        .filter_map(|suggestion| suggestion.topic.as_ref())
        .map(|topic| topic.key.clone())
        .collect()
}

/// A topic a generation session names, or names again, through
/// `macro.suggestions.nameTopic`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NameTopic {
    /// Names the topic across nights; the same key updates the same topic.
    pub key: String,
    /// What it is, in a few words.
    pub name: String,
    /// Why it matters now; left out when no item says.
    #[serde(default)]
    pub reason: Option<TopicReason>,
}
