//! Small account and reply projections used by shared conversation orchestration.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    connection::{ConnectionStatus, ReplyContent, SendReply},
    media::MediaCapability,
    models::MessagingError,
    policy::ReplyMode,
};

/// Immutable account scope plus current health, without provider credentials or policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountScope {
    /// Retained connection identity.
    pub id: Uuid,
    /// Owning Macro team; provider permission never substitutes for membership.
    pub team_id: Uuid,
    /// Authorization generation fenced at durable dispatch.
    pub generation: Option<DateTime<Utc>>,
    /// Current account health.
    pub status: ConnectionStatus,
}

/// Operations implemented by this integration, independently of current permission.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ReplyCapabilities {
    /// Supported explicit sending modes.
    pub modes: Vec<ReplyMode>,
    /// Maximum text units.
    pub text_limit: u16,
    /// Whether text is counted in UTF-8 bytes instead of Unicode characters.
    pub text_limit_in_bytes: bool,
    /// Supported private attachment categories and effective limits.
    pub media: Vec<MediaCapability>,
    /// Maximum files in one implemented send operation.
    pub max_attachments: u8,
}

/// Stable reason a supported operation cannot run now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ReplyBlockReason {
    /// Macro access or deliberate human authority is missing.
    Forbidden,
    /// The account needs reconnecting or recovery.
    Disconnected,
    /// A new customer message is required.
    WindowClosed,
    /// An approved template is required.
    TemplateRequired,
    /// The account is not approved for explicit human support.
    HumanSupportRequired,
    /// This operation is not implemented by the provider.
    Unsupported,
}

impl ReplyBlockReason {
    /// Preserve existing public errors while exposing a stable eligibility reason.
    pub fn error(self) -> MessagingError {
        match self {
            Self::Forbidden => MessagingError::Forbidden,
            Self::Disconnected => MessagingError::Disconnected,
            Self::WindowClosed => MessagingError::ReplyWindowClosed,
            Self::TemplateRequired => MessagingError::TemplateRequired,
            Self::HumanSupportRequired => MessagingError::HumanSupportRequired,
            Self::Unsupported => MessagingError::Invalid("this sending mode is unsupported"),
        }
    }
}

/// Current server decision for one implemented sending mode.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ModeEligibility {
    /// Explicit operation whose eligibility was evaluated.
    pub mode: ReplyMode,
    /// True only when every current server-side condition is satisfied.
    pub allowed: bool,
    /// Stable explanation when blocked.
    pub reason: Option<ReplyBlockReason>,
    /// An allowed control may expire locally; the browser cannot extend permission.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Eligibility is a snapshot, re-evaluated before dispatch.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ReplyEligibility {
    /// Server time used to evaluate every mode in this response.
    pub evaluated_at: DateTime<Utc>,
    /// Current decisions, separate from static implemented support.
    pub modes: Vec<ModeEligibility>,
}

impl ReplyEligibility {
    /// Macro access and account health constrain even a permissive provider policy.
    pub fn restrict(&mut self, account: &AccountScope, can_send: bool) {
        let reason = if !can_send {
            Some(ReplyBlockReason::Forbidden)
        } else if account.status != ConnectionStatus::Connected {
            Some(ReplyBlockReason::Disconnected)
        } else {
            None
        };
        if let Some(reason) = reason {
            for mode in &mut self.modes {
                mode.allowed = false;
                mode.reason = Some(reason);
                mode.expires_at = None;
            }
        }
    }

    /// Require an explicit, unexpired positive decision for this operation.
    pub fn require(&self, mode: ReplyMode, now: DateTime<Utc>) -> Result<(), MessagingError> {
        let decision = self
            .modes
            .iter()
            .find(|entry| entry.mode == mode)
            .ok_or_else(|| ReplyBlockReason::Unsupported.error())?;
        if !decision.allowed {
            return Err(decision
                .reason
                .unwrap_or(ReplyBlockReason::Unsupported)
                .error());
        }
        if decision.expires_at.is_some_and(|until| now >= until) {
            return Err(ReplyBlockReason::WindowClosed.error());
        }
        Ok(())
    }
}

/// Provider support and eligibility evaluated together from current account facts.
pub struct ReplyOptions {
    /// Implemented operations and content limits.
    pub capabilities: ReplyCapabilities,
    /// Provider eligibility, further restricted by Macro authorization.
    pub eligibility: ReplyEligibility,
}

/// Compatibility mapping from the unchanged durable send request to an explicit mode.
pub fn reply_mode(request: &SendReply) -> ReplyMode {
    match request.message {
        ReplyContent::Template { .. } => ReplyMode::ApprovedTemplate,
        _ if request.human_support => ReplyMode::HumanSupport,
        _ => ReplyMode::FreeForm,
    }
}

impl ReplyCapabilities {
    /// Validate implemented support and content before provider-specific input checks.
    pub fn validate(&self, request: &SendReply) -> Result<(), MessagingError> {
        if request.idempotency_key.is_nil() {
            return Err(MessagingError::Invalid(
                "a stable send intent key is required",
            ));
        }
        if !self.modes.contains(&reply_mode(request)) {
            return Err(ReplyBlockReason::Unsupported.error());
        }
        if let ReplyContent::Text { text } = &request.message {
            let length = if self.text_limit_in_bytes {
                text.len()
            } else {
                text.chars().count()
            };
            if text.trim().is_empty() || length > usize::from(self.text_limit) {
                return Err(MessagingError::Invalid(
                    "message exceeds this provider's text limit or is empty",
                ));
            }
        }
        if let ReplyContent::Media { kind, caption, .. } = &request.message {
            let capability = self
                .media
                .iter()
                .find(|entry| entry.kind == *kind)
                .filter(|_| self.max_attachments > 0)
                .ok_or(MessagingError::Invalid(
                    "attachments are unsupported for this account",
                ))?;
            if let Some(caption) = caption.as_deref().filter(|text| !text.is_empty()) {
                let limit = capability.caption_limit.ok_or(MessagingError::Invalid(
                    "send this attachment's caption as a separate text reply",
                ))?;
                if caption.chars().count() > usize::from(limit) {
                    return Err(MessagingError::Invalid("attachment caption is too long"));
                }
            }
        }
        Ok(())
    }

    /// Check authorized file bytes against this account's implemented media limits.
    pub fn validate_media(
        &self,
        kind: super::events::MediaKind,
        mime: &str,
        bytes: usize,
    ) -> Result<(), MessagingError> {
        let supported = self.max_attachments > 0
            && self.media.iter().any(|entry| {
                entry.kind == kind
                    && entry.mime_types.iter().any(|value| value == mime)
                    && bytes > 0
                    && bytes <= entry.max_bytes as usize
            });
        if !supported {
            return Err(MessagingError::Invalid(
                "attachment type or size is unsupported for this provider",
            ));
        }
        Ok(())
    }
}
