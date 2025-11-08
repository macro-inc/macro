use async_openai::{error::OpenAIError, types::CompletionUsage};

#[derive(Debug, Clone)]
pub struct Usage {
    input_tokens: usize,
    output_tokens: usize,
    resp_obj: CompletionUsage,
}

impl From<CompletionUsage> for Usage {
    fn from(value: CompletionUsage) -> Self {
        Self {
            input_tokens: value.prompt_tokens as usize,
            output_tokens: value.completion_tokens as usize,
            resp_obj: value,
        }
    }
}

impl Usage {
    pub fn total_tokens(&self) -> usize {
        self.input_tokens + self.output_tokens
    }
    pub fn get_response_obj(&self) -> CompletionUsage {
        self.resp_obj.clone()
    }
    pub fn get_input_and_output_tokens(&self) -> (usize, usize) {
        (self.input_tokens, self.output_tokens)
    }
}

#[derive(Clone, Debug)]
pub struct ChatStreamCompletionContent {
    pub content: String,
    pub usage: Option<Usage>,
}

impl ChatStreamCompletionContent {
    fn new(content: String, usage: Option<Usage>) -> Self {
        Self { content, usage }
    }
}

#[derive(Clone, Debug)]
pub enum ChatStreamCompletionResponse {
    Content(ChatStreamCompletionContent),
}

impl ChatStreamCompletionResponse {
    pub fn new_content(content: String, usage: Option<CompletionUsage>) -> Self {
        Self::Content(ChatStreamCompletionContent::new(
            content,
            usage.map(Into::into),
        ))
    }
}

#[derive(Debug)]
pub enum ConversionError {
    NoConversion,
    Other(anyhow::Error),
}

#[derive(Debug)]
pub enum ChatCompletionError {
    /// The request was rejected the provider
    RequestError(anyhow::Error),
    /// The model refused to generate content
    Refusal(String),
    /// The model did not return any content
    NoContent,
    /// This provider is not supported
    Unsupported,
}

impl std::fmt::Display for ChatCompletionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatCompletionError::RequestError(e) => {
                write!(f, "ChatCompletionError::RequestError({})", e)
            }
            ChatCompletionError::Refusal(s) => {
                write!(f, "ChatCompletionError::Refusal({})", s)
            }
            ChatCompletionError::NoContent => {
                write!(f, "ChatCompletionError::NoContent")
            }
            ChatCompletionError::Unsupported => {
                write!(f, "ChatCompletionError::Unsupported")
            }
        }
    }
}

impl std::error::Error for ChatCompletionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ChatCompletionError::RequestError(err) => err.source(),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for ConversionError {
    fn from(err: anyhow::Error) -> Self {
        ConversionError::Other(err)
    }
}

impl From<OpenAIError> for ChatCompletionError {
    fn from(value: OpenAIError) -> Self {
        ChatCompletionError::RequestError(value.into())
    }
}
