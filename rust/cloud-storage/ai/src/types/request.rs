use super::{
    message::{Base64Image, ChatMessage, SystemPrompt},
    model::Model,
};

#[derive(Debug, Clone)]
pub struct ChatCompletionRequest {
    /// can either be openai or google
    pub(crate) model: Model,
    /// List of messages NOT including the system prompt
    pub(crate) messages: Vec<ChatMessage>,
    /// System prompt for the chat request
    pub(crate) system_prompt: SystemPrompt,
}

#[derive(PartialEq, Eq, Clone)]
pub enum ImageData {
    Bytes(Base64Image),
    Url(String),
}

impl ImageData {
    /// convert image bytes into a downscaled webp
    pub fn try_from_bytes(bytes: Vec<u8>) -> Result<Self, anyhow::Error> {
        Base64Image::compress_and_reencode(bytes).map(Self::Bytes)
    }

    pub(crate) fn dangerously_try_from_string(s: String) -> Result<Self, anyhow::Error> {
        if s.starts_with("data:") {
            Ok(Self::Bytes(Base64Image::dangerously_try_from_string(s)?))
        } else {
            Ok(Self::Url(s))
        }
    }
}

impl std::fmt::Debug for ImageData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bytes(base_64) => {
                write!(f, "bytes {:?}", base_64)
            }
            Self::Url(url) => write!(f, "url {}", url),
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
