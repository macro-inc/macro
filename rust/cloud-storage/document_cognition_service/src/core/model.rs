use ai::types::Model;

pub static CHAT_MODELS: &[Model] = &[Model::Claude45Haiku, Model::Claude46Opus];
pub static FALLBACK_MODEL: Model = Model::Claude45Haiku;
