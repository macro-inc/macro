//! SQS-backed implementation of the [`AiProjectionQueue`] outbound port.

use models_ai_projection::AiProjectionQueueMessage;
use sqs_client::SQS;

use crate::domain::{ai_projection_queue::AiProjectionQueue, model::AiProjectionError};

impl AiProjectionQueue for SQS {
    async fn enqueue_materialization(
        &self,
        message: AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        self.enqueue_ai_projection_message(message)
            .await
            .map_err(AiProjectionError::StorageLayerError)
    }
}
