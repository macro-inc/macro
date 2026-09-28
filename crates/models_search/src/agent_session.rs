//! Public search responses for folded ACP conversations.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Side of a folded conversation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionAuthor {
    /// User prompt.
    User,
    /// Agent response.
    Agent,
}

/// Stable navigation target from the fold, independent of raw ACP log IDs.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SearchGotoAgentSession {
    /// Fold-assigned turn.
    pub message_turn: u32,
    /// Author within the turn.
    pub author: AgentSessionAuthor,
}

impl From<opensearch_client::search::model::SearchGotoAgentSession> for SearchGotoAgentSession {
    fn from(value: opensearch_client::search::model::SearchGotoAgentSession) -> Self {
        use opensearch_client::search::model::AgentSessionAuthor as Author;
        Self {
            message_turn: value.message_turn,
            author: match value.author {
                Author::User => AgentSessionAuthor::User,
                Author::Agent => AgentSessionAuthor::Agent,
            },
        }
    }
}

/// A name match or one matching folded message.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AgentSessionSearchResult {
    /// Absent for a name-only match.
    pub goto: Option<SearchGotoAgentSession>,
    /// Matched name/content fragments.
    pub highlight: crate::SearchHighlight,
    /// Search score.
    pub score: Option<f64>,
}

/// One accessible agent session, grouped with its matching folded messages.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct AgentSessionSearchResponseItem {
    /// Session ID.
    pub id: Uuid,
    /// Current persisted name.
    pub name: String,
    /// Session owner.
    pub owner_id: String,
    /// Agent persona ID.
    pub bot_id: Uuid,
    /// Session creation time.
    pub created_at: DateTime<Utc>,
    /// Current persisted modification time.
    pub updated_at: DateTime<Utc>,
    /// Name and folded-message matches.
    pub agent_session_search_results: Vec<AgentSessionSearchResult>,
}
