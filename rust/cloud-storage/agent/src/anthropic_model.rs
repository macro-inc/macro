use rig_core::OneOrMany;
/// Newtype around the Anthropic [`CompletionModel`] that merges consecutive
/// `User` messages before each request.
///
/// RIG's agentic loop creates one `User` message per tool result, but the
/// Anthropic API requires all `tool_result` blocks for a batch of
/// `tool_use` calls to appear in a single `User` message. This wrapper
/// fixes that at the model boundary so the rest of the stack is unaware.
use rig_core::completion::{
    CompletionError, CompletionModel, CompletionRequest, CompletionRequestBuilder,
    CompletionResponse,
};
use rig_core::message::Message;
use rig_core::providers::anthropic;
use rig_core::streaming::StreamingCompletionResponse;

type Inner = anthropic::completion::CompletionModel;

/// Anthropic completion model that merges consecutive user messages.
#[derive(Clone)]
pub struct AnthropicModel(Inner);

impl AnthropicModel {
    /// Wrap a raw Anthropic completion model.
    pub fn new(inner: Inner) -> Self {
        Self(inner)
    }
}

impl CompletionModel for AnthropicModel {
    type Response = <Inner as CompletionModel>::Response;
    type StreamingResponse = <Inner as CompletionModel>::StreamingResponse;
    type Client = <Inner as CompletionModel>::Client;

    fn make(client: &Self::Client, model: impl Into<String>) -> Self {
        Self(Inner::make(client, model))
    }

    async fn completion(
        &self,
        mut request: CompletionRequest,
    ) -> Result<CompletionResponse<Self::Response>, CompletionError> {
        request.chat_history = merge_consecutive_user(request.chat_history);
        self.0.completion(request).await
    }

    async fn stream(
        &self,
        mut request: CompletionRequest,
    ) -> Result<StreamingCompletionResponse<Self::StreamingResponse>, CompletionError> {
        request.chat_history = merge_consecutive_user(request.chat_history);
        self.0.stream(request).await
    }

    fn completion_request(&self, prompt: impl Into<Message>) -> CompletionRequestBuilder<Self> {
        CompletionRequestBuilder::new(self.clone(), prompt)
    }
}

fn merge_consecutive_user(history: OneOrMany<Message>) -> OneOrMany<Message> {
    let messages: Vec<Message> = history.into_iter().collect();
    if messages.len() < 2 {
        return OneOrMany::many(messages).unwrap_or_else(|_| OneOrMany::one(Message::user("")));
    }

    let mut merged: Vec<Message> = Vec::with_capacity(messages.len());

    for msg in messages {
        if matches!(&msg, Message::User { .. })
            && merged
                .last()
                .is_some_and(|m| matches!(m, Message::User { .. }))
        {
            let Message::User {
                content: new_content,
            } = msg
            else {
                unreachable!()
            };
            let Some(Message::User { content: existing }) = merged.last_mut() else {
                unreachable!()
            };
            for item in new_content {
                existing.push(item);
            }
        } else {
            merged.push(msg);
        }
    }

    OneOrMany::many(merged).unwrap_or_else(|_| OneOrMany::one(Message::user("")))
}

#[cfg(test)]
mod test;
