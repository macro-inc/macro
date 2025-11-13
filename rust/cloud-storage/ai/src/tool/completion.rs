use super::types::ToolCall;
use super::types::tool_object::ToolObject;
use crate::types::{AiError, Result};
use crate::types::{ChatCompletionRequest, OpenRouterClient};
use async_openai::types::{
    ChatCompletionTool, ChatCompletionToolChoiceOption, CreateChatCompletionRequest,
};

#[tracing::instrument(skip(tool))]
pub async fn tool_completion<T>(
    request: ChatCompletionRequest,
    tool: &ToolObject<T>,
) -> Result<ToolCall> {
    let mut request: CreateChatCompletionRequest = request.try_into()?;
    request.tools = Some(vec![ChatCompletionTool::from(tool)]);
    request.n = Some(1);
    request.tool_choice = Some(ChatCompletionToolChoiceOption::Required);

    let client = OpenRouterClient::new();
    let response = client.chat().create(request).await?;

    response
        .choices
        .first()
        .ok_or_else(|| anyhow::anyhow!("No choices").into())
        .and_then(|choice| {
            let call = choice
                .message
                .tool_calls
                .as_ref()
                .ok_or_else(|| AiError::from(anyhow::anyhow!("No tool calls")))?
                .first()
                .ok_or_else(|| AiError::from(anyhow::anyhow!("No tool calls")))?;
            Ok(ToolCall {
                id: call.id.clone(),
                json: serde_json::from_str(&call.function.arguments)?,
                name: call.function.name.clone(),
            })
        })
}
