//! One-shot completion — send a prompt and get a string response.
//!
//! This is the non-streaming API layer: routing only resolves a model, and the
//! actual prompting lives here.
#[cfg(test)]
mod test;

use crate::model::router::{ModelRouter, RoutedModel};
use crate::telemetry::{ChatSpanHook, GenAiContext, TracedModel};
use ai_usage::{UsageContext, UsageRecorder};
use genai_telemetry::ContentPolicy;
use rig_agent::agent::{AgentBuilder, PromptResponse};
use rig_agent::completion::Prompt;
use rig_core::completion::CompletionModel;
use rig_core::message::Message;

const ONE_SHOT_MAX_TOKENS: u64 = 16_000;

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
    let routed = ModelRouter::shared()?.route_or_default(&model);
    let telemetry = telemetry_for(&ctx, &routed);
    let response = match routed {
        RoutedModel::Anthropic(m) => {
            prompt_once(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                user_message,
                telemetry,
            )
            .await?
        }
        RoutedModel::OpenAiChatCompletions(m) => {
            prompt_once(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                user_message,
                telemetry,
            )
            .await?
        }
        RoutedModel::OpenAiResponses(m) => {
            prompt_once(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                user_message,
                telemetry,
            )
            .await?
        }
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
    let routed = ModelRouter::shared()?.route_or_default(&model);
    let telemetry = telemetry_for(&ctx, &routed);
    let response = match routed {
        RoutedModel::Anthropic(m) => {
            prompt_with_history(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                messages,
                telemetry,
            )
            .await?
        }
        RoutedModel::OpenAiChatCompletions(m) => {
            prompt_with_history(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                messages,
                telemetry,
            )
            .await?
        }
        RoutedModel::OpenAiResponses(m) => {
            prompt_with_history(
                TracedModel::new(m.completion(), telemetry.clone()),
                system_prompt,
                messages,
                telemetry,
            )
            .await?
        }
    };
    record(recorder, ctx, model, &response);
    Ok(response.output)
}

/// GenAI telemetry for a one-shot completion: named after the feature making
/// it, reporting the routed model, with no conversation (a one-shot has none).
fn telemetry_for(ctx: &UsageContext, routed: &RoutedModel<'_>) -> GenAiContext {
    let telemetry = GenAiContext::new(
        None,
        ctx.feature.to_string(),
        ContentPolicy::from_env(),
        true,
    );
    telemetry.set_model(routed.provider(), routed.model_name());
    telemetry
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

/// Build a toolless agent and prompt it with a single user message.
///
/// The model is a [`TracedModel`]; `telemetry` also drives the hook that
/// records the model's output on the `chat` span.
async fn prompt_once<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    user_message: &str,
    telemetry: GenAiContext,
) -> anyhow::Result<PromptResponse> {
    let agent = AgentBuilder::new(completion_model)
        .name(telemetry.agent_name())
        .record_content_telemetry(false)
        .preamble(system_prompt)
        .max_tokens(ONE_SHOT_MAX_TOKENS)
        .build();

    Ok(agent
        .prompt(user_message)
        .extended_details()
        .add_hook(ChatSpanHook(telemetry))
        .await?)
}

/// Build a toolless agent and prompt it with the last message of `messages`,
/// using the rest as history.
async fn prompt_with_history<M: CompletionModel + 'static>(
    completion_model: M,
    system_prompt: &str,
    messages: Vec<Message>,
    telemetry: GenAiContext,
) -> anyhow::Result<PromptResponse> {
    let agent = AgentBuilder::new(completion_model)
        .name(telemetry.agent_name())
        .record_content_telemetry(false)
        .preamble(system_prompt)
        .max_tokens(ONE_SHOT_MAX_TOKENS)
        .build();

    let Some((prompt, history)) = messages.split_last() else {
        anyhow::bail!("messages must not be empty");
    };

    Ok(agent
        .prompt(prompt.clone())
        .extended_details()
        .history(history.to_vec())
        .add_hook(ChatSpanHook(telemetry))
        .await?)
}
