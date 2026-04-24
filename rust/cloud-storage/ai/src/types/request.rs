use super::{ChatMessage, ImageData, SystemPrompt, model::Model};

#[derive(Debug, Clone)]
pub struct ChatCompletionRequest {
    /// can either be openai or google
    pub(crate) model: Model,
    /// List of messages NOT including the system prompt
    pub(crate) messages: Vec<ChatMessage>,
    /// System prompt for the chat request
    pub(crate) system_prompt: SystemPrompt,
}

impl std::fmt::Debug for ImageData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base64(base_64) => {
                write!(f, "bytes {:?}", base_64)
            }
            Self::StaticUrl(url) => write!(f, "url {}", url),
        }
    }
}

impl ChatCompletionRequest {
    pub fn model(&self) -> Model {
        self.model
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }
}
