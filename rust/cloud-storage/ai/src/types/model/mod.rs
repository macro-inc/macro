use anyhow::Result;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use strum::{Display, EnumIter, EnumString};
use utoipa::ToSchema;
mod metadata;
pub use metadata::*;

#[derive(
    Serialize,
    Deserialize,
    Debug,
    Clone,
    PartialEq,
    Eq,
    Display,
    EnumString,
    EnumIter,
    Copy,
    ToSchema,
    Default,
)]
pub enum Model {
    // Google models  ------------------------------------------------------------ //
    #[strum(serialize = "google/gemini-2.5-pro")]
    #[serde(rename = "google/gemini-2.5-pro")]
    Gemini25Pro,

    #[strum(serialize = "google/gemini-2.0-flash-001")]
    #[serde(rename = "google/gemini-2.0-flash-001")]
    Gemini20Flash,

    #[strum(serialize = "google/gemini-2.0-flash-lite-001")]
    #[serde(rename = "google/gemini-2.0-flash-lite-001")]
    Gemini20FlashLite,

    #[serde(rename = "google/gemini-pro-1.5")]
    #[strum(serialize = "google/gemini-pro-1.5")]
    Gemini15Pro,

    // OpenAI models  ------------------------------------------------------------ //
    #[serde(rename = "openai/gpt-5")]
    #[strum(serialize = "openai/gpt-5")]
    OpenAiGpt5,

    #[serde(rename = "openai/gpt-4.1")]
    #[strum(serialize = "openai/gpt-4.1")]
    OpenAiGpt41,

    #[strum(serialize = "openai/gpt-4o")]
    #[serde(rename = "openai/gpt-4o")]
    OpenAIGPT4o,

    #[strum(serialize = "openai/gpt-4o-mini")]
    #[serde(rename = "openai/gpt-4o-mini")]
    OpenAIGPT4oMini,

    #[strum(serialize = "openai/o1")]
    #[serde(rename = "openai/o1")]
    OpenAIo1,

    #[strum(serialize = "openai/gpt-4o-search-preview")]
    #[serde(rename = "openai/gpt-4o-search-preview")]
    OpenAIGPT4oSearchPreview,

    #[strum(serialize = "openai/gpt-4o-mini-search-preview")]
    #[serde(rename = "openai/gpt-4o-mini-search-preview")]
    // NB typo OpenAI**G**gpt
    OpenAIGgpt4oMiniSearchPreview,

    #[strum(serialize = "openai/o3")]
    #[serde(rename = "openai/o3")]
    OpenAIo3,

    #[serde(rename = "anthropic/claude-3.5-sonnet")]
    #[strum(serialize = "anthropic/claude-3.5-sonnet")]
    Claude35Sonnet,

    #[serde(rename = "anthropic/claude-3.7-sonnet")]
    #[strum(serialize = "anthropic/claude-3.7-sonnet")]
    Claude37Sonnet,

    #[serde(rename = "anthropic/claude-sonnet-4")]
    #[strum(serialize = "anthropic/claude-sonnet-4")]
    #[default]
    Claude4Sonnet,
}

pub mod constants {
    /// String versions of models, without a version (the default [`super::Model`] serialization
    /// includes the version of the model).
    pub mod models {
        pub const GEMINI_25_PRO_PREVIEW: &str = "gemini-2.5-pro-preview";
        pub const GEMINI_20_FLASH: &str = "gemini-2.0-flash";
        pub const GEMINI_20_FLASH_LITE: &str = "gemini-2.0-flash-lite";
        pub const GEMINI_15_PRO: &str = "gemini-pro";
        pub const OPEN_AI_GPT_5: &str = "gpt-5";
        pub const OPEN_AI_GPT_41: &str = "gpt-4.1";
        pub const OPEN_AI_GPT_4O: &str = "gpt-4o";
        pub const OPEN_AI_GPT_4O_MINI: &str = "gpt-4o-mini";
        pub const OPEN_AI_O1: &str = "o1";
        pub const OPEN_AI_GPT_4O_SEARCH_PREVIEW: &str = "gpt-4o-search-preview";
        pub const OPEN_AI_GPT_4O_MINI_SEARCH_PREVIEW: &str = "gpt-4o-mini-search-preview";
        pub const OPEN_AI_O3: &str = "o3";
        pub const CLAUDE_35_SONNET: &str = "claude-3.5-sonnet";
        pub const CLAUDE_37_SONNET: &str = "claude-3.7-sonnet";
        pub const CLAUDE_4_SONNET: &str = "claude-sonnet-4";
    }

    /// String versions of providers
    pub mod providers {
        pub const GOOGLE: &str = "google";
        pub const OPEN_AI: &str = "openai";
        pub const ANTHROPIC: &str = "anthropic";
    }
}

impl Model {
    pub fn to_provider_model_string(&self) -> (&'static str, &'static str) {
        use constants::models::*;
        use constants::providers::*;
        match self {
            Model::Gemini25Pro => (GOOGLE, GEMINI_25_PRO_PREVIEW),
            Model::Gemini20Flash => (GOOGLE, GEMINI_20_FLASH),
            Model::Gemini20FlashLite => (GOOGLE, GEMINI_20_FLASH_LITE),
            Model::Gemini15Pro => (GOOGLE, GEMINI_15_PRO),
            Model::OpenAiGpt5 => (OPEN_AI, OPEN_AI_GPT_5),
            Model::OpenAiGpt41 => (OPEN_AI, OPEN_AI_GPT_41),
            Model::OpenAIGPT4o => (OPEN_AI, OPEN_AI_GPT_4O),
            Model::OpenAIGPT4oMini => (OPEN_AI, OPEN_AI_GPT_4O_MINI),
            Model::OpenAIo1 => (OPEN_AI, OPEN_AI_O1),
            Model::OpenAIGPT4oSearchPreview => (OPEN_AI, OPEN_AI_GPT_4O_SEARCH_PREVIEW),
            Model::OpenAIGgpt4oMiniSearchPreview => (OPEN_AI, OPEN_AI_GPT_4O_MINI_SEARCH_PREVIEW),
            Model::OpenAIo3 => (OPEN_AI, OPEN_AI_O3),
            Model::Claude35Sonnet => (ANTHROPIC, CLAUDE_35_SONNET),
            Model::Claude37Sonnet => (ANTHROPIC, CLAUDE_37_SONNET),
            Model::Claude4Sonnet => (ANTHROPIC, CLAUDE_4_SONNET),
        }
    }
    pub fn from_model_str(model: &str) -> Option<Self> {
        use constants::models::*;
        Some(match model {
            GEMINI_25_PRO_PREVIEW => Model::Gemini25Pro,
            GEMINI_20_FLASH => Model::Gemini20Flash,
            GEMINI_20_FLASH_LITE => Model::Gemini20FlashLite,
            GEMINI_15_PRO => Model::Gemini15Pro,
            OPEN_AI_GPT_41 => Model::OpenAiGpt41,
            OPEN_AI_GPT_4O => Model::OpenAIGPT4o,
            OPEN_AI_GPT_4O_MINI => Model::OpenAIGPT4oMini,
            OPEN_AI_O1 => Model::OpenAIo1,
            OPEN_AI_GPT_4O_SEARCH_PREVIEW => Model::OpenAIGPT4oSearchPreview,
            OPEN_AI_GPT_4O_MINI_SEARCH_PREVIEW => Model::OpenAIGgpt4oMiniSearchPreview,
            OPEN_AI_O3 => Model::OpenAIo3,
            CLAUDE_35_SONNET => Model::Claude35Sonnet,
            CLAUDE_37_SONNET => Model::Claude37Sonnet,
            CLAUDE_4_SONNET => Model::Claude4Sonnet,
            _unknown => return None,
        })
    }
}

/// Serialize [`Model`] as strings from [`constants::models`].
pub fn serialize_model_without_version<S>(model: &Model, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let (_, model_string) = model.to_provider_model_string();
    serializer.serialize_str(model_string)
}

/// Deserialize [`Model`] from strings from [`models`]
pub fn deserialize_model_without_version<'de, D>(deserializer: D) -> Result<Model, D::Error>
where
    D: Deserializer<'de>,
{
    let model_str = String::deserialize(deserializer)?;
    Model::from_model_str(&model_str)
        .ok_or_else(|| serde::de::Error::custom(format!("Unknown model: {}", model_str)))
}
