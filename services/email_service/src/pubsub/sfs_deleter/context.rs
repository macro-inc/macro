use crate::outbound::sfs_deletion::{PgSfsDeletion, SfsDeletionClient};
use email::domain::attachment_cleanup::sfs_deletion::SfsDeletionService;
use std::sync::Arc;

#[derive(Clone)]
pub struct SFSDeleteContext {
    pub service: Arc<SfsDeletionService<PgSfsDeletion, SfsDeletionClient>>,
    pub sqs_worker: sqs_worker::SQSWorker,
}
