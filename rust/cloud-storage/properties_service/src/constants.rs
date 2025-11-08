use uuid::Uuid;

/// Metadata property display names
pub mod metadata {
    pub const DOCUMENT_NAME: &str = "Document Name";
    pub const OWNER: &str = "Owner";
    pub const CREATED_AT: &str = "Created At";
    pub const LAST_UPDATED: &str = "Last Updated";
    pub const PROJECT: &str = "Project";
}

/// Special UUID used for system-generated metadata properties.
/// This distinguishes metadata properties from user-created properties.
pub const METADATA_PROPERTY_ID: Uuid = Uuid::from_u128(0xFFFFFFFF_FFFF_FFFF_FFFF_FFFFFFFFFFFF);
