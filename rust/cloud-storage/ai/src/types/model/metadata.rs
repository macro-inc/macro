use super::Model;
use serde::{Deserialize, Serialize};
use strum::Display;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetadata {
    pub context_window: i32,
}

#[derive(Display, Debug, Serialize, Deserialize, ToSchema, PartialEq, PartialOrd, Clone)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    // OpenAI
    OpenAI,
    // Google
    Google,
    // Anthropic
    Anthropic,
    // Anthropic via Google
    GoogleAnthropic,
    // XAI
    XAI,
}

pub trait ModelWithMetadataAndProvider {
    fn metadata(&self) -> ModelMetadata;
    fn provider(&self) -> Provider;
    fn is_valid_provider(&self, provider: &Provider) -> bool;
}

impl ModelWithMetadataAndProvider for Model {
    fn metadata(&self) -> ModelMetadata {
        match self {
            Model::Gemini25Pro => ModelMetadata {
                context_window: 1_000_000,
            },

            Model::OpenAiGpt5 => ModelMetadata {
                context_window: 400_000,
            },
            Model::OpenAiGpt41 => ModelMetadata {
                context_window: 1_047_576,
            },
            Model::OpenAIGPT4o => ModelMetadata {
                context_window: 128000,
            },
            Model::OpenAIo1 => ModelMetadata {
                context_window: 128000,
            },
            Model::OpenAIo3 => ModelMetadata {
                context_window: 200_000,
            },
            Model::Gemini20Flash => ModelMetadata {
                context_window: 1_048_576,
            },
            Model::Gemini20FlashLite => ModelMetadata {
                context_window: 1_048_576,
            },
            Model::Gemini15Pro => ModelMetadata {
                context_window: 2_097_152,
            },
            Model::Claude35Sonnet => ModelMetadata {
                context_window: 200_000,
            },
            Model::Claude37Sonnet => ModelMetadata {
                context_window: 200_000,
            },
            Model::Claude45Sonnet => ModelMetadata {
                context_window: 200_000,
            },
            Model::Claude45Haiku => ModelMetadata {
                context_window: 200_000,
            },
            Model::Claude4Sonnet => ModelMetadata {
                context_window: 200_000,
            },
            Model::OpenAIGPT4oMini => ModelMetadata {
                context_window: 128_000,
            },
            Model::OpenAIGPT4oSearchPreview => ModelMetadata {
                context_window: 128_000,
            },
            Model::OpenAIGgpt4oMiniSearchPreview => ModelMetadata {
                context_window: 128_000,
            },
        }
    }

    fn provider(&self) -> Provider {
        match self {
            // OpenAI models //
            Model::OpenAiGpt5 => Provider::OpenAI,
            Model::OpenAiGpt41 => Provider::OpenAI,
            Model::OpenAIGPT4o => Provider::OpenAI,
            Model::OpenAIo1 => Provider::OpenAI,
            Model::OpenAIGPT4oMini => Provider::OpenAI,
            Model::OpenAIGPT4oSearchPreview => Provider::OpenAI,
            Model::OpenAIGgpt4oMiniSearchPreview => Provider::OpenAI,
            Model::OpenAIo3 => Provider::OpenAI,
            // Google models /
            Model::Gemini25Pro => Provider::Google,
            Model::Gemini20Flash => Provider::Google,
            Model::Gemini15Pro => Provider::Google,
            Model::Gemini20FlashLite => Provider::Google,
            // Anthropic models //
            Model::Claude4Sonnet => Provider::Anthropic,
            Model::Claude37Sonnet => Provider::Anthropic,
            Model::Claude35Sonnet => Provider::Anthropic,
            Model::Claude45Sonnet => Provider::Anthropic,
            Model::Claude45Haiku => Provider::Anthropic,
            // XAI models //
        }
    }

    fn is_valid_provider(&self, provider: &Provider) -> bool {
        match (self, provider) {
            // Google models //
            (Model::Gemini25Pro, Provider::Google) => true,
            (Model::Gemini20Flash, Provider::Google) => true,
            (Model::Gemini15Pro, Provider::Google) => true,

            // OpenAI models //
            (Model::OpenAiGpt41, Provider::OpenAI) => true,
            (Model::OpenAIGPT4o, Provider::OpenAI) => true,
            (Model::OpenAIo1, Provider::OpenAI) => true,
            (Model::OpenAIGPT4oMini, Provider::OpenAI) => true,
            // Anthropic models //
            (Model::Claude37Sonnet, Provider::Anthropic) => true,
            (Model::Claude37Sonnet, Provider::GoogleAnthropic) => true,
            _ => false,
        }
    }
}
