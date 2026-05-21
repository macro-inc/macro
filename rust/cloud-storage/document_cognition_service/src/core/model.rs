use agent::AgentModel;

pub static CHAT_MODELS: &[AgentModel] = &[AgentModel::Smart, AgentModel::Fast];
pub static FALLBACK_MODEL: AgentModel = AgentModel::Haiku4_5;
