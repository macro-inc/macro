use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Where mail from an assigned sender is met.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EmailSurface {
    /// Mail the user needs to see.
    Signal,
    /// Mail the user wants to see, without obligation.
    Feed,
    /// Mail the user may need to reference later.
    Noise,
}

impl EmailSurface {
    /// Signal when `important` is true, otherwise Noise. Used when a caller
    /// has not named a surface.
    pub fn from_important(important: bool) -> Self {
        if important { Self::Signal } else { Self::Noise }
    }

    /// Mute/promote still stores `is_important`. Only Signal is important.
    pub fn is_important(self) -> bool {
        matches!(self, Self::Signal)
    }

    /// Database `email_filters.surface` value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Signal => "signal",
            Self::Feed => "feed",
            Self::Noise => "noise",
        }
    }
}

impl std::str::FromStr for EmailSurface {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "signal" => Ok(Self::Signal),
            "feed" => Ok(Self::Feed),
            "noise" => Ok(Self::Noise),
            _ => Err(()),
        }
    }
}

/// A sender-level surface assignment.
///
/// Each filter targets either an email address or a domain (never both).
#[derive(Debug, Clone)]
pub struct EmailFilter {
    /// Database primary key.
    pub id: Uuid,
    /// The email link this filter belongs to.
    pub link_id: Uuid,
    /// Exact email address match (mutually exclusive with `email_domain`).
    pub email_address: Option<String>,
    /// Domain match (mutually exclusive with `email_address`).
    pub email_domain: Option<String>,
    /// Whether matching senders should be considered important.
    pub is_important: bool,
    /// Surface matching senders are assigned to.
    pub surface: EmailSurface,
    /// When this filter was created.
    pub created_at: DateTime<Utc>,
}

/// Input for creating or updating an email filter.
#[derive(Debug, Clone)]
pub struct UpsertEmailFilterInput {
    /// Exact email address (mutually exclusive with `email_domain`).
    pub email_address: Option<String>,
    /// Domain (mutually exclusive with `email_address`).
    pub email_domain: Option<String>,
    /// Whether matching senders should be considered important.
    pub is_important: bool,
    /// Surface to assign. When omitted, derived from `is_important`.
    pub surface: Option<EmailSurface>,
}

impl UpsertEmailFilterInput {
    /// Resolved surface: explicit value, or Signal/Noise from `is_important`.
    pub fn surface(&self) -> EmailSurface {
        self.surface
            .unwrap_or_else(|| EmailSurface::from_important(self.is_important))
    }
}
