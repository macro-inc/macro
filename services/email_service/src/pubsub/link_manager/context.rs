use std::sync::Arc;

#[derive(Clone)]
pub struct LinkManagerContext {
    pub(crate) service: Arc<crate::outbound::link_manager::LinkManager>,
    pub sqs_worker: sqs_worker::SQSWorker,
}
