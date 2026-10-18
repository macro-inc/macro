//! Explicit human-send authority and implemented sending modes.

/// Sending intent authenticated by the invoking path, not a client actor flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendAuthority {
    /// A person explicitly submitting an external reply.
    Human,
    /// Drafting never authorizes a provider request.
    DraftOnly,
}

/// Policy mode of the requested send.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ReplyMode {
    /// Ordinary text or media reply.
    FreeForm,
    /// Server-resolved, approved, account-bound template.
    ApprovedTemplate,
    /// Explicit human-authored support reply, where implemented.
    HumanSupport,
}

/// Maximum age of an intent that has not crossed a dispatch fence, in seconds.
pub const SEND_EXPIRY_SECONDS: i32 = 10 * 60;
