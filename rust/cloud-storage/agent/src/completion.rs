/// One-shot completion — send a prompt and get a string response.
use crate::anthropic_model::AnthropicModel;
use crate::model::AgentModel;
use rig_core::client::{CompletionClient, ProviderClient};
use rig_core::completion::Prompt;
use rig_core::message::Message;
use rig_core::providers::anthropic;

/// Send a system prompt + user message and return the model's text response.
///
/// This is the simple, non-streaming path for one-shot tasks like
/// summarization.
#[tracing::instrument(skip(system_prompt, user_message), err)]
pub async fn complete(
    model: AgentModel,
    system_prompt: &str,
    user_message: &str,
) -> anyhow::Result<String> {
    let client = anthropic::Client::from_env()?;
    let raw_model = client.completion_model(model.api_id());
    let wrapped = AnthropicModel::new(raw_model);

    let agent = rig_core::agent::AgentBuilder::new(wrapped)
        .preamble(system_prompt)
        .max_tokens(16_000)
        .build();

    let response = agent.prompt(user_message).await?;
    Ok(response)
}

/// Send a system prompt + conversation history and return the model's text
/// response.
#[tracing::instrument(skip(system_prompt, messages), err)]
pub async fn complete_with_history(
    model: AgentModel,
    system_prompt: &str,
    messages: Vec<Message>,
) -> anyhow::Result<String> {
    let client = anthropic::Client::from_env()?;
    let raw_model = client.completion_model(model.api_id());
    let wrapped = AnthropicModel::new(raw_model);

    let agent = rig_core::agent::AgentBuilder::new(wrapped)
        .preamble(system_prompt)
        .max_tokens(16_000)
        .build();

    let Some((prompt, history)) = messages.split_last() else {
        anyhow::bail!("messages must not be empty");
    };

    let response = agent
        .prompt(prompt.clone())
        .with_history(history.to_vec())
        .await?;
    Ok(response)
}
