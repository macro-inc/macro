use uuid::Uuid;

/// Metadata property display names
pub mod metadata {
    // Document metadata
    pub const DOCUMENT_NAME: &str = "Document Name";
    pub const DOCUMENT_OWNER: &str = "Owner";
    pub const DOCUMENT_CREATED_AT: &str = "Created At";
    pub const DOCUMENT_LAST_UPDATED: &str = "Last Updated";
    pub const DOCUMENT_PROJECT: &str = "Project";

    // Thread metadata
    pub const THREAD_SUBJECT: &str = "Subject";
    pub const THREAD_STARTED: &str = "Thread Started";
    pub const THREAD_LAST_RECEIVED: &str = "Last Received";
    pub const THREAD_LAST_SENT: &str = "Last Sent";
    pub const THREAD_MESSAGES: &str = "Messages";
}

/// Special UUID used for system-generated metadata properties.
/// This distinguishes metadata properties from user-created properties.
pub const METADATA_PROPERTY_ID: Uuid = Uuid::from_u128(0xFFFFFFFF_FFFF_FFFF_FFFF_FFFFFFFFFFFF);
