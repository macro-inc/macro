//! Model availability for chat, gated by the user's plan.
//!
//! Free (non-professional) users may use only [`FREE_MODEL`]; professional
//! users may use every model in [`CHAT_MODELS`].

use agent::AgentModel;
use serde::Serialize;
use utoipa::ToSchema;

/// The chat models offered to users, best-first.
pub const CHAT_MODELS: &[AgentModel] = &[
    AgentModel::Smart,
    AgentModel::Fast,
    AgentModel::Gpt5_5,
    AgentModel::Gpt5Mini,
];

/// The only model available to free (non-professional) users.
pub const FREE_MODEL: AgentModel = AgentModel::Fast;

/// A chat model paired with whether the requesting user may use it.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelAccess {
    /// Provider api id — the string sent when this model is selected.
    pub id: String,
    /// Provider serving the model (e.g. `anthropic`, `openai`).
    pub provider: String,
    /// Context window size in tokens.
    pub context_window: u64,
    /// Whether the requesting user has access to this model.
    pub available: bool,
}

/// Response body for the models-access endpoint: every chat model, each
/// flagged with the requesting user's access.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ModelsResponse {
    /// All chat models, in display order.
    pub models: Vec<ModelAccess>,
}
