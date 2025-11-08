use super::{
    message::{ChatMessage, SystemPrompt},
    model::Model,
};
use crate::tokens::TokenCount;
use crate::tokens::count_tokens;
use anyhow::Result;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatCompletionRequest {
    /// can either be openai or google
    pub(crate) model: Model,
    /// List of messages NOT including the system prompt
    pub(crate) messages: Vec<ChatMessage>,
    /// System prompt for the chat request
    pub(crate) system_prompt: SystemPrompt,
}

impl TokenCount for Vec<&String> {
    fn token_count(&self) -> Result<i64> {
        let mut tokens = 0;
        for message in self {
            tokens += count_tokens(message.as_str())?;
        }
        Ok(tokens)
    }
}

impl TokenCount for ChatCompletionRequest {
    fn token_count(&self) -> Result<i64> {
        let mut tokens = 0;
        for message in self.messages.iter() {
            tokens += message.token_count()?;
        }
        tokens += self.system_prompt.token_count()?;
        Ok(tokens)
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
