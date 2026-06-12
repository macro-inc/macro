use agent::AgentModel;

/// Chat models offered to users — single source of truth lives in the chat crate.
pub use chat::domain::models::CHAT_MODELS;

pub static FALLBACK_MODEL: AgentModel = AgentModel::Haiku4_5;
