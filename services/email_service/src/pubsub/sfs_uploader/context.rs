use crate::outbound::sfs_upload::{
    PgSfsPhotoContacts, PgSfsPhotoMappings, PhotoSyncedGateway, SfsPhotoUploadClient,
};
use email::domain::mailbox::contacts::sfs_upload::SfsPhotoUploadService;
use std::sync::Arc;

/// Concrete contact-photo use case assembled by the worker context builder.
pub type SfsUploadUseCase = SfsPhotoUploadService<
    PgSfsPhotoMappings,
    PgSfsPhotoContacts,
    SfsPhotoUploadClient,
    PhotoSyncedGateway,
>;

#[derive(Clone)]
pub struct SFSUploaderContext {
    pub service: Arc<SfsUploadUseCase>,
    pub sqs_worker: sqs_worker::SQSWorker,
}
