/// One-shot completion — send a prompt and get a string response.
use crate::model::{AgentModel, ModelProvider};
use rig_core::client::{CompletionClient, ProviderClient};
use rig_core::completion::{CompletionModel, Prompt};
use rig_core::message::Message;
use rig_core::providers::{anthropic, openai};

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
    match model.provider() {
        ModelProvider::Anthropic => {
            let client = anthropic::Client::from_env()?;
            prompt_once(
                client.completion_model(model.api_id()),
                system_prompt,
                user_message,
            )
            .await
        }
        ModelProvider::OpenAi => {
            let client = openai::Client::from_env()?;
            prompt_once(
                client.completion_model(model.api_id()),
                system_prompt,
                user_message,
            )
            .await
        }
    }
}

/// Send a system prompt + conversation history and return the model's text
/// response.
#[tracing::instrument(skip(system_prompt, messages), err)]
pub async fn complete_with_history(
    model: AgentModel,
    system_prompt: &str,
    messages: Vec<Message>,
) -> anyhow::Result<String> {
    match model.provider() {
        ModelProvider::Anthropic => {
            let client = anthropic::Client::from_env()?;
            prompt_with_history(
                client.completion_model(model.api_id()),
                system_prompt,
                messages,
            )
            .await
        }
        ModelProvider::OpenAi => {
            let client = openai::Client::from_env()?;
            prompt_with_history(
                client.completion_model(model.api_id()),
                system_prompt,
                messages,
            )
            .await
        }
    }
}

async fn prompt_once<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    user_message: &str,
) -> anyhow::Result<String> {
    let agent = rig_core::agent::AgentBuilder::new(completion_model)
        .preamble(system_prompt)
        .max_tokens(16_000)
        .build();

    let response = agent.prompt(user_message).await?;
    Ok(response)
}

async fn prompt_with_history<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    messages: Vec<Message>,
) -> anyhow::Result<String> {
    let agent = rig_core::agent::AgentBuilder::new(completion_model)
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
