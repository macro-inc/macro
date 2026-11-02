pub mod header_names {
    pub const MACRO_INTERNAL_AUTH_KEY_HEADER_KEY: &str = "x-internal-auth-key";
    pub const MACRO_DOCUMENT_STORAGE_SERVICE_AUTH_HEADER_KEY: &str =
        "x-document-storage-service-auth-key";
    pub const AUTHORIZATION: &str = "Authorization";
}

pub const USER_PEER_D1_BINDING: &str = "USER_PEER_MAPPING";

/// Author of operations written without a user: snapshots that services
/// initialize documents from (markdown and Notion imports, uploads, copies of
/// unattributed history). Keep in sync with the web history UI
/// (`SYSTEM_AUTHOR_ID`).
pub const SYSTEM_AUTHOR_ID: &str = "system";
