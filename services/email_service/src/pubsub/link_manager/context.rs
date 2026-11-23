use std::sync::Arc;

#[derive(Clone)]
pub struct LinkManagerContext {
    pub(crate) service: Arc<super::worker::LinkManager>,
    pub sqs_worker: sqs_worker::SQSWorker,
}
