//! Outbound port for enqueueing ai projection materialization requests.

use models_ai_projection::AiProjectionQueueMessage;

use crate::domain::model::AiProjectionError;

/// The AiProjectionQueue defines how the service hands off a projection
/// instance for asynchronous materialization (e.g. by enqueueing onto SQS).
pub trait AiProjectionQueue: Clone + Send + Sync + 'static {
    /// Enqueues a request to materialize the referenced projection instance.
    fn enqueue_materialization(
        &self,
        message: AiProjectionQueueMessage,
    ) -> impl Future<Output = Result<(), AiProjectionError>> + Send;
}
