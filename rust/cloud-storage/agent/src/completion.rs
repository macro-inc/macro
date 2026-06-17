/// One-shot completion — send a prompt and get a string response.
use crate::model::router::{AllModelsRouter, RoutedModel};
use crate::model::types::Model;
use crate::provider_env;
use ai_usage::{UsageContext, UsageRecorder};
use rig_core::agent::PromptResponse;
use rig_core::completion::{CompletionModel, Prompt};
use rig_core::message::Message;
use std::sync::Arc;

/// Build a router over provider clients from `APP_SECRETS_JSON` or the environment.
///
/// `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are required.
fn env_router() -> anyhow::Result<AllModelsRouter> {
    let anthropic = Arc::new(provider_env::anthropic_client_from_env()?);
    let openai = Arc::new(provider_env::openai_client_from_env()?);
    Ok(AllModelsRouter::new(anthropic, openai))
}

/// Send a system prompt + user message and return the model's text response.
///
/// This is the simple, non-streaming path for one-shot tasks like
/// summarization. `model` is anything stringifiable to an api id — an
/// [`AgentModel`](crate::AgentModel) or a raw string from the frontend.
///
/// Token usage is recorded against `ctx` via `recorder` once the completion
/// returns. Recording is best-effort and never affects the result.
#[tracing::instrument(skip(model, system_prompt, user_message, recorder, ctx), err)]
pub async fn complete<M: ToString>(
    model: M,
    system_prompt: &str,
    user_message: &str,
    recorder: &dyn UsageRecorder,
    ctx: UsageContext,
) -> anyhow::Result<String> {
    let model = model.to_string();
    let response = match env_router()?.route_or_default(&model) {
        RoutedModel::Anthropic(m) => {
            prompt_once(m.completion(), system_prompt, user_message).await?
        }
        RoutedModel::OpenAi(m) => prompt_once(m.completion(), system_prompt, user_message).await?,
    };
    record(recorder, ctx, model, &response);
    Ok(response.output)
}

/// Send a system prompt + conversation history and return the model's text
/// response.
///
/// Usage is recorded against `ctx` via `recorder`, as in [`complete`].
#[tracing::instrument(skip(model, system_prompt, messages, recorder, ctx), err)]
pub async fn complete_with_history<M: ToString>(
    model: M,
    system_prompt: &str,
    messages: Vec<Message>,
    recorder: &dyn UsageRecorder,
    ctx: UsageContext,
) -> anyhow::Result<String> {
    let model = model.to_string();
    let response = match env_router()?.route_or_default(&model) {
        RoutedModel::Anthropic(m) => {
            prompt_with_history(m.completion(), system_prompt, messages).await?
        }
        RoutedModel::OpenAi(m) => {
            prompt_with_history(m.completion(), system_prompt, messages).await?
        }
    };
    record(recorder, ctx, model, &response);
    Ok(response.output)
}

/// Record the usage of a one-shot completion.
fn record(
    recorder: &dyn UsageRecorder,
    ctx: UsageContext,
    model: String,
    response: &PromptResponse,
) {
    recorder.record(ctx.into_event(
        model,
        response.usage.input_tokens,
        response.usage.output_tokens,
    ));
}

async fn prompt_once<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    user_message: &str,
) -> anyhow::Result<PromptResponse> {
    let agent = rig_core::agent::AgentBuilder::new(completion_model)
        .preamble(system_prompt)
        .max_tokens(16_000)
        .build();

    Ok(agent.prompt(user_message).extended_details().await?)
}

async fn prompt_with_history<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    messages: Vec<Message>,
) -> anyhow::Result<PromptResponse> {
    let agent = rig_core::agent::AgentBuilder::new(completion_model)
        .preamble(system_prompt)
        .max_tokens(16_000)
        .build();

    let Some((prompt, history)) = messages.split_last() else {
        anyhow::bail!("messages must not be empty");
    };

    Ok(agent
        .prompt(prompt.clone())
        .extended_details()
        .with_history(history.to_vec())
        .await?)
}
