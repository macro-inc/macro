use super::{ChatMessage, SystemPrompt, model::Model};

#[derive(Debug)]
pub struct ChatCompletionRequest {
    /// can either be openai or google
    pub(crate) model: Model,
    /// List of messages NOT including the system prompt
    pub(crate) messages: Vec<ChatMessage>,
    /// System prompt for the chat request
    pub(crate) system_prompt: SystemPrompt,
}

impl ChatCompletionRequest {
    pub fn model(&self) -> Model {
        self.model
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }
}
