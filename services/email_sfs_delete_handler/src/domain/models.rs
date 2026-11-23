use uuid::Uuid;

/// An orphaned attachment row and the static file it references.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OrphanedAttachment {
    pub(crate) db_id: Uuid,
    pub(crate) sfs_id: Uuid,
}
