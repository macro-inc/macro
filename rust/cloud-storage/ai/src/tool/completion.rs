use super::types::ToolCall;
use super::types::tool_object::ToolObject;
use crate::openai_toolset::tool_object_to_chat_completion_tool;
use crate::types::{AiError, Result};
use crate::types::{ChatCompletionRequest, OpenRouterClient};
use async_openai::types::chat::{
    ChatCompletionMessageToolCalls, ChatCompletionToolChoiceOption, ChatCompletionTools,
    CreateChatCompletionRequest, ToolChoiceOptions,
};

#[tracing::instrument(skip(tool))]
pub async fn tool_completion<T>(
    request: ChatCompletionRequest,
    tool: &ToolObject<T>,
) -> Result<ToolCall> {
    let mut request: CreateChatCompletionRequest = request.try_into()?;
    request.tools = Some(vec![ChatCompletionTools::Function(
        tool_object_to_chat_completion_tool(tool),
    )]);
    request.n = Some(1);
    request.tool_choice = Some(ChatCompletionToolChoiceOption::Mode(
        ToolChoiceOptions::Required,
    ));

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
            match call {
                ChatCompletionMessageToolCalls::Function(tool_call) => Ok(ToolCall {
                    id: tool_call.id.clone(),
                    json: serde_json::from_str(&tool_call.function.arguments)?,
                    name: tool_call.function.name.clone(),
                }),
                ChatCompletionMessageToolCalls::Custom(_) => Err(AiError::from(anyhow::anyhow!(
                    "Unexpected custom tool call"
                ))),
            }
        })
}
