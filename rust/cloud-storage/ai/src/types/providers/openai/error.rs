use crate::types::AiError;
use async_openai::error::OpenAIError;

impl From<OpenAIError> for AiError {
    fn from(value: OpenAIError) -> Self {
        match &value {
            OpenAIError::ApiError(api_err) => {
                // for anthropic error formatting
                if api_err.message.contains("tokens >") {
                    println!("{:?} -> CONTEXT WIDOW", value);
                    Self::ContextWindowExceeded
                } else {
                    println!("{:?} -> GENERIC", value);
                    Self::Generic(value.into())
                }
            }
            _ => Self::Generic(value.into()),
        }
    }
}
