//! What one probe round writes and what search must show for it.

use std::time::Duration;

use rand::Rng as _;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The kind of entity a round changes, named as the indexer's `entity_type`
/// tag (services/search_processing_service) so the probe's seconds and the
/// indexer's lag read side by side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, strum::IntoStaticStr, strum::EnumIter)]
#[strum(serialize_all = "snake_case")]
pub enum EntityType {
    /// A markdown document.
    Document,
    /// A channel message.
    Message,
    /// A project.
    Project,
    /// A text property value on a document.
    Property,
    /// An agent session.
    AgentSession,
    /// A call record.
    Call,
}

impl EntityType {
    /// The metric tag value.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// The change a round makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum Operation {
    /// A new entity.
    Create,
    /// New body text, or a new property value.
    Edit,
    /// A new title.
    Rename,
    /// The entity removed from search for good.
    Delete,
}

impl Operation {
    /// The metric tag value.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

/// The id of an entity the probe user owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityId(pub Uuid);

impl std::fmt::Display for EntityId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Starts every title the probe writes, so its entities and fixtures are
/// recognisable, and found by it.
pub const MARKER: &str = "Search probe";

/// Length of a [`Token`]: 26^20 values, so no real content matches one.
const TOKEN_LEN: usize = 20;

/// A random word written into an entity so that exactly that entity matches
/// it. Lowercase letters only, so every analyzer keeps it as one term.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Token(String);

impl Token {
    /// A fresh token.
    pub fn random() -> Self {
        let mut rng = rand::rng();
        Self(
            (0..TOKEN_LEN)
                .map(|_| char::from(rng.random_range(b'a'..=b'z')))
                .collect(),
        )
    }

    /// The token's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// A title holding the token: [`MARKER`], then the token.
    pub fn title(&self) -> String {
        format!("{MARKER} {}", self.0)
    }
}

/// What a search asks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchQuery {
    /// Entities of `entity_type` that contain `token`.
    Text {
        /// The type searched.
        entity_type: EntityType,
        /// The exact word.
        token: Token,
    },
    /// Documents titled with `name` whose text property `property_id` holds
    /// `value`. Search needs words to match, so the property filter narrows a
    /// title search.
    Property {
        /// The property definition.
        property_id: EntityId,
        /// The token in the document's title.
        name: Token,
        /// The exact value.
        value: Token,
    },
}

/// Whether a check wants its entity among a query's hits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    /// The entity matches.
    Present,
    /// The entity does not match.
    Absent,
}

/// One condition on search: `entity_id` is, or is not, among the hits of
/// `query`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// What is searched.
    pub query: SearchQuery,
    /// The entity changed.
    pub entity_id: EntityId,
    /// Whether it should match.
    pub presence: Presence,
}

impl Check {
    /// Whether `hits`, the ids `query` returned, satisfy this check.
    pub fn holds(&self, hits: &[EntityId]) -> bool {
        let found = hits.contains(&self.entity_id);
        match self.presence {
            Presence::Present => found,
            Presence::Absent => !found,
        }
    }
}

/// A write the API acknowledged, with what search shows once it is indexed:
/// the new token matches, the token it replaced does not, and a deleted entity
/// matches nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    /// What was changed.
    pub operation: Operation,
    /// The entity changed.
    pub entity_id: EntityId,
    /// All of them hold at once when the change is searchable.
    pub checks: Vec<Check>,
}

/// How a round ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Search showed the change this long after the write was acknowledged.
    Seen(Duration),
    /// Search still did not show it when the round gave up.
    Unseen,
    /// The write failed: the probe's own failure, not a freshness miss.
    WriteFailed,
    /// The search that would have decided the round failed.
    SearchFailed,
}

impl Outcome {
    /// The metric tag value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Seen(_) => "seen",
            Self::Unseen => "unseen",
            Self::WriteFailed => "write_failed",
            Self::SearchFailed => "search_failed",
        }
    }
}

/// One finished round, as the metrics record it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Round {
    /// The type changed.
    pub entity_type: EntityType,
    /// The change made.
    pub operation: Operation,
    /// How it ended.
    pub outcome: Outcome,
}
