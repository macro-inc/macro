use std::{fmt::Debug, future::Future};

use super::models::OrphanedAttachment;

pub(crate) trait OrphanRepository: Send + Sync {
    // Keep the concrete error's Debug representation for the existing log contract.
    type Error: Debug;

    fn find_orphaned(
        &self,
    ) -> impl Future<Output = Result<Vec<OrphanedAttachment>, Self::Error>> + Send;
}

pub(crate) trait DeleteQueue: Send + Sync {
    type Error: Debug;

    fn enqueue(
        &self,
        attachment: OrphanedAttachment,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

pub(crate) trait SfsDeleteService: Send + Sync {
    fn enqueue_orphaned_attachments(&self) -> impl Future<Output = ()> + Send;
}
