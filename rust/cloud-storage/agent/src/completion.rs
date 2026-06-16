/// One-shot completion — send a prompt and get a string response.
use crate::model::router::{AllModelsRouter, RoutedModel};
use crate::model::types::Model;
use rig_core::client::ProviderClient;
use rig_core::completion::{CompletionModel, Prompt};
use rig_core::message::Message;
use rig_core::providers::{anthropic, openai};
use std::sync::Arc;

/// Build a router over provider clients from the environment.
///
/// `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are required.
fn env_router() -> anyhow::Result<AllModelsRouter> {
    let anthropic = Arc::new(anthropic::Client::from_env()?);
    let openai = Arc::new(openai::Client::from_env()?);
    Ok(AllModelsRouter::new(anthropic, openai))
}

/// Send a system prompt + user message and return the model's text response.
///
/// This is the simple, non-streaming path for one-shot tasks like
/// summarization. `model` is anything stringifiable to an api id — an
/// [`AgentModel`](crate::AgentModel) or a raw string from the frontend.
#[tracing::instrument(skip(model, system_prompt, user_message), err)]
pub async fn complete<M: ToString>(
    model: M,
    system_prompt: &str,
    user_message: &str,
) -> anyhow::Result<String> {
    match env_router()?.route_or_default(&model.to_string()) {
        RoutedModel::Anthropic(m) => prompt_once(m.completion(), system_prompt, user_message).await,
        RoutedModel::OpenAi(m) => prompt_once(m.completion(), system_prompt, user_message).await,
    }
}

/// Send a system prompt + conversation history and return the model's text
/// response.
#[tracing::instrument(skip(model, system_prompt, messages), err)]
pub async fn complete_with_history<M: ToString>(
    model: M,
    system_prompt: &str,
    messages: Vec<Message>,
) -> anyhow::Result<String> {
    match env_router()?.route_or_default(&model.to_string()) {
        RoutedModel::Anthropic(m) => {
            prompt_with_history(m.completion(), system_prompt, messages).await
        }
        RoutedModel::OpenAi(m) => {
            prompt_with_history(m.completion(), system_prompt, messages).await
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
