use super::Model;
use serde::{Deserialize, Serialize};
use strum::Display;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetadata {
    /// A description of the model
    pub description: String,
    /// The token size of the context window
    pub context_window: i32,
    /// Scale of speed from 0 to 5
    pub speed: i32,
    /// Scale of quality from 0 to 5
    pub quality: i32,
    // Whether the model is premium or not (free or paid)
    pub premium: bool,
    /// The display name of the model
    pub display_name: String,
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
                description: "Google Gemini 2.5 Pro is the latest and most intelligent model for complex tasks".to_string(),
                context_window: 1_000_000,
                speed: 4,
                quality: 5,
                premium: true,
                display_name: "Gemini 2.5 Pro".to_string()
            },

            Model::OpenAiGpt5 => ModelMetadata {
                description: "OpenAI GPT-41 is the latest high intelligence model for complex, multi-step tasks".to_string(),
                context_window: 400_000,
                speed: 5,
                quality: 5,
                premium: false,
                display_name: "GPT-5".to_string()
            },
            Model::OpenAiGpt41 => ModelMetadata {
                description: "OpenAI GPT-41 is the latest high intelligence model for complex, multi-step tasks".to_string(),
                context_window: 1_047_576,
                speed: 4,
                quality: 5,
                premium: true,
                display_name: "GPT-4.1".to_string()
            },
            Model::OpenAIGPT4o => ModelMetadata {
                description: "OpenAI GPT-4o is a high-intelligence flagship model for complex, multi-step tasks".to_string(),
                context_window: 128000,
                speed: 4,
                quality: 5,
                premium: true,
                display_name: "GPT-4o".to_string(),
            },
            Model::OpenAIo1 => ModelMetadata {
                description: "OpenAI o1 is an advanced reasoning model optimized for complex problem-solving through deep, multi-step analysis".to_string(),
                context_window: 128000,
                speed: 0,
                quality: 5,
                premium: true,
                display_name: "o1".to_string(),

            },
            Model::OpenAIo3 => ModelMetadata {
                description: "OpenAI o3 is an advanced reasoning model optimized for complex problem-solving through deep, multi-step analysis".to_string(),
                context_window: 200_000,
                speed: 0,
                quality: 5,
                premium: true,
                display_name: "o3".to_string(),

            },
            Model::Gemini20Flash => ModelMetadata {
                description: "Gemini 2.0 Flash is a fast and powerful model for complex reasoning tasks".to_string(),
                context_window: 1_048_576,
                speed: 5,
                quality: 4,
                premium: false,
                display_name: "Gemini 2.0 Flash".to_string(),
            },
            Model::Gemini20FlashLite => ModelMetadata {
                description: "I am speed".to_string(),
                context_window: 1_048_576,
                speed: 5,
                quality: 3,
                premium: false,
                display_name: "Gemini 2.0 Flash Lite".to_string()
            },
            Model::Gemini15Pro => ModelMetadata {
                description: "Gemini 1.5 Pro is a large model for complex reasoning with large documents".to_string(),
                context_window: 2_097_152,
                speed: 2,
                quality: 4,
                premium: true,
                display_name: "Gemini 1.5 Pro".to_string(),
            },
            Model::Claude35Sonnet => ModelMetadata {
                description: "Claude 3.5 Sonnet is a strong workhorse model trained by Anthropic".to_string(),
                context_window: 200_000,
                speed: 4,
                quality: 4,
                premium: true,
                display_name: "Claude 3.5 Sonnet".to_string(),
            },
            Model::Claude37Sonnet => ModelMetadata {
                description: "Claude 3.7 Sonnet is the flagship large language model trained by Anthropic".to_string(),
                context_window: 200_000,
                speed: 4,
                quality: 5,
                premium: true,
                display_name: "Claude 3.7 Sonnet".to_string(),
            },

            Model::Claude4Sonnet => ModelMetadata {
                description: "Claude 4.0 Sonnet is the flagship large language model trained by Anthropic".to_string(),
                context_window: 200_000,
                speed: 4,
                quality: 5,
                premium: true,
                display_name: "Claude 4.0 Sonnet".to_string(),
            },

            Model::OpenAIGPT4oMini => ModelMetadata {
                description: "OpenAI GPT-4o Mini is a small model for complex reasoning tasks".to_string(),
                context_window: 128_000,
                speed: 4,
                quality: 2,
                premium: false,
                display_name: "GPT-4o Mini".to_string(),
            },
            Model::OpenAIGPT4oSearchPreview => ModelMetadata {
                description: "OpenAI GPT-4o-Search-Preview is a strong model for internet search".to_string(),
                context_window: 128_000,
                speed: 4,
                quality: 4,
                premium: false,
                display_name: "GPT-4o Search Preview".to_string(),
            },
            Model::OpenAIGgpt4oMiniSearchPreview => ModelMetadata {
                description: "OpenAI GPT-4o-Mini-Search-Preview is a lightweight model for internet search".to_string(),
                context_window: 128_000,
                speed: 4,
                quality: 2,
                premium: false,
                display_name: "GPT-4o Search Preview".to_string(),
            }
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
