use ai::types::Model;

pub static CHAT_MODELS: &[Model] = &[Model::Claude45Haiku, Model::Claude45Sonnet];

pub static ONE_MODEL: Model = Model::Claude45Haiku;

pub static COMPLETION_MODEL: Model = Model::OpenAiGpt41;
pub static COMPLETION_CONTEXT_WINDOW: i32 = 80000;
pub static FALLBACK_MODEL: Model = Model::Claude45Haiku;
