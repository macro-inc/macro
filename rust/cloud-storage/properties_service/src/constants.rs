use uuid::Uuid;

/// Metadata property display names
pub mod metadata {
    // Document metadata
    pub const DOCUMENT_NAME: &str = "Document Name";
    pub const OWNER: &str = "Owner";
    pub const CREATED_AT: &str = "Created At";
    pub const LAST_UPDATED: &str = "Last Updated";
    pub const PROJECT: &str = "Project";

    // Thread metadata
    pub const SUBJECT: &str = "Subject";
    pub const THREAD_STARTED: &str = "Thread Started";
    pub const LAST_RECEIVED: &str = "Last Received";
    pub const LAST_SENT: &str = "Last Sent";
    pub const MESSAGES: &str = "Messages";
}

/// Special UUID used for system-generated metadata properties.
/// This distinguishes metadata properties from user-created properties.
pub const METADATA_PROPERTY_ID: Uuid = Uuid::from_u128(0xFFFFFFFF_FFFF_FFFF_FFFF_FFFFFFFFFFFF);
