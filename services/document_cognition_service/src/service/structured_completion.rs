//! Bounded tool-free completions using the shared agent completion path.

use agent::{MeteringContext, structured_output::DynamicSchema};
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use std::{future::Future, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tracing::Instrument;

#[cfg(test)]
mod test;

const MAX_CONCURRENT_COMPLETIONS: usize = 16;
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(90);

/// A one-shot structured completion, with no tools or discovery phase.
pub struct ToolFreeRequest {
    pub model: String,
    pub system_prompt: String,
    pub prompt: String,
    pub schema: DynamicSchema,
}

/// Sanitized capacity and deadline errors, or the shared completion failure.
#[derive(Debug, thiserror::Error)]
pub enum ToolFreeCompletionError {
    #[error("structured completions are busy; retry later")]
    Busy,
    #[error("the structured completion timed out")]
    Timeout,
    #[error("structured completion failed: {0}")]
    Failed(#[source] anyhow::Error),
}

/// An already authorized and admitted tool-free completion.
/// Uses object-safe async dispatch so composition roots can supply `Arc<dyn ...>`.
#[async_trait]
pub trait ToolFreeCompletion: Send + Sync + 'static {
    async fn complete(
        &self,
        owner: MacroUserIdStr<'static>,
        request: ToolFreeRequest,
    ) -> Result<Value, ToolFreeCompletionError>;
}

/// Capacity and cancellation policy around the existing metered completion.
pub struct ToolFreeCompletionService {
    recorder: Arc<dyn UsageRecorder>,
    completions: Arc<Semaphore>,
}

impl ToolFreeCompletionService {
    pub fn new(recorder: Arc<dyn UsageRecorder>) -> Self {
        Self {
            recorder,
            completions: Arc::new(Semaphore::new(MAX_CONCURRENT_COMPLETIONS)),
        }
    }

    async fn run(
        &self,
        completion: impl Future<Output = anyhow::Result<Value>> + Send + 'static,
    ) -> Result<Value, ToolFreeCompletionError> {
        let permit = self
            .completions
            .clone()
            .try_acquire_owned()
            .map_err(|_| ToolFreeCompletionError::Busy)?;
        let metering = MeteringContext::current();
        // The task survives HTTP/client cancellation so provider-returned usage
        // is still recorded. Capacity remains reserved until finish or deadline.
        tokio::spawn(
            MeteringContext::carry(metering, async move {
                let _permit = permit;
                tokio::time::timeout(COMPLETION_TIMEOUT, completion)
                    .await
                    .map_err(|_| ToolFreeCompletionError::Timeout)?
                    .map_err(ToolFreeCompletionError::Failed)
            })
            .instrument(tracing::Span::current()),
        )
        .await
        .map_err(|_| ToolFreeCompletionError::Failed(anyhow::anyhow!("completion task stopped")))?
    }
}

#[async_trait]
impl ToolFreeCompletion for ToolFreeCompletionService {
    async fn complete(
        &self,
        owner: MacroUserIdStr<'static>,
        request: ToolFreeRequest,
    ) -> Result<Value, ToolFreeCompletionError> {
        let recorder = self.recorder.clone();
        self.run(async move {
            agent::structured_output::dynamic_structured_completion(
                request.model,
                &request.system_prompt,
                vec![agent::Message::user(request.prompt)],
                request.schema,
                recorder.as_ref(),
                UsageContext::new(AiFeature::DynamicCompletionsApi, owner),
            )
            .await
        })
        .await
    }
}
