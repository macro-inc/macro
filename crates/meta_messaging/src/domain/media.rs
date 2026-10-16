//! Supported media policy, shared by API validation, dispatch and the composer.

use super::events::MediaKind;
use serde::{Deserialize, Serialize};

/// Macro's bounded private-file path, even when the provider permits larger files.
pub const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;

/// One currently supported provider attachment category.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature="schema",schema(as=MetaMediaCapability))]
pub struct MediaCapability {
    /// Native attachment category.
    pub kind: MediaKind,
    /// Allowed MIME types for the selected account.
    pub mime_types: Vec<String>,
    /// Effective provider and Macro byte limit.
    pub max_bytes: u32,
    /// Maximum caption characters, absent when text must be sent separately.
    pub caption_limit: Option<u16>,
}
