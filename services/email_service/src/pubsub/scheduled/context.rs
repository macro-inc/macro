use crate::composition::workers::ScheduledDelivery;
use std::sync::Arc;

/// Scheduled delivery service and its receive/acknowledgement handle.
#[derive(Clone)]
pub struct ScheduledContext {
    pub sqs_worker: sqs_worker::SQSWorker,
    pub service: Arc<ScheduledDelivery>,
}
