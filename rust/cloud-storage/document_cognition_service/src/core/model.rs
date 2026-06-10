use agent::AgentModel;

pub static CHAT_MODELS: &[AgentModel] = &[
    AgentModel::Smart,
    AgentModel::Fast,
    AgentModel::Gpt5_5,
    AgentModel::Gpt5Mini,
];
pub static FALLBACK_MODEL: AgentModel = AgentModel::Haiku4_5;
