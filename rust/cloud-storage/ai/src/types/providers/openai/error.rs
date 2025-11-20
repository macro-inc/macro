use crate::types::AiError;
use async_openai::error::OpenAIError;

impl From<OpenAIError> for AiError {
    fn from(value: OpenAIError) -> Self {
        match &value {
            OpenAIError::ApiError(api_err) => {
                // for anthropic error formatting
                if api_err.message.contains("tokens >") {
                    Self::ContextWindowExceeded
                } else {
                    Self::Generic(value.into())
                }
            }
            _ => Self::Generic(value.into()),
        }
    }
}
