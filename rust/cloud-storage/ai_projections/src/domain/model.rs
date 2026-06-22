//! Domain models, enums, and error types for ai projections.

use std::{fmt::Display, str::FromStr};

use chrono::{DateTime, Utc};

/// The kind of entity a projection is materialized for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum TargetType {
    /// The projection targets an individual user.
    User,
    /// The projection targets a team.
    Team,
}

/// How frequently an active projection is regenerated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum RefreshCadence {
    /// Regenerate frequently.
    High,
    /// Regenerate at a moderate rate.
    Medium,
    /// Regenerate infrequently.
    Low,
}

/// How long a projection remains active without being requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum Expiry {
    /// Expires after a day.
    Day,
    /// Expires after a week.
    Week,
    /// Expires after a month.
    Month,
}

/// The materialization status of a user's projection instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub enum ProjectionStatus {
    /// The projection is being materialized for the first time.
    Loading,
    /// The projection instance exists but has no materialized result yet.
    Cold,
    /// The projection has a materialized result available.
    Ready,
    /// The projection is being refreshed in the background.
    Refreshing,
    /// The projection failed to materialize.
    Error,
}

impl Display for RefreshCadence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            RefreshCadence::High => "high",
            RefreshCadence::Medium => "medium",
            RefreshCadence::Low => "low",
        };
        write!(f, "{s}")
    }
}

impl FromStr for RefreshCadence {
    type Err = ParseEnumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "high" => Ok(RefreshCadence::High),
            "medium" => Ok(RefreshCadence::Medium),
            "low" => Ok(RefreshCadence::Low),
            other => Err(ParseEnumError::new("RefreshCadence", other)),
        }
    }
}

impl Display for Expiry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Expiry::Day => "day",
            Expiry::Week => "week",
            Expiry::Month => "month",
        };
        write!(f, "{s}")
    }
}

impl FromStr for Expiry {
    type Err = ParseEnumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "day" => Ok(Expiry::Day),
            "week" => Ok(Expiry::Week),
            "month" => Ok(Expiry::Month),
            other => Err(ParseEnumError::new("Expiry", other)),
        }
    }
}

impl Display for ProjectionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ProjectionStatus::Loading => "loading",
            ProjectionStatus::Cold => "cold",
            ProjectionStatus::Ready => "ready",
            ProjectionStatus::Refreshing => "refreshing",
            ProjectionStatus::Error => "error",
        };
        write!(f, "{s}")
    }
}

impl FromStr for ProjectionStatus {
    type Err = ParseEnumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "loading" => Ok(ProjectionStatus::Loading),
            "cold" => Ok(ProjectionStatus::Cold),
            "ready" => Ok(ProjectionStatus::Ready),
            "refreshing" => Ok(ProjectionStatus::Refreshing),
            "error" => Ok(ProjectionStatus::Error),
            other => Err(ParseEnumError::new("ProjectionStatus", other)),
        }
    }
}

impl Display for TargetType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            TargetType::User => "user",
            TargetType::Team => "team",
        };
        write!(f, "{s}")
    }
}

impl FromStr for TargetType {
    type Err = ParseEnumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(TargetType::User),
            "team" => Ok(TargetType::Team),
            other => Err(ParseEnumError::new("TargetType", other)),
        }
    }
}

/// Error returned when a stored string cannot be parsed into a domain enum.
#[derive(Debug, thiserror::Error)]
#[error("invalid {kind} value: {value}")]
pub struct ParseEnumError {
    /// The name of the enum that failed to parse.
    pub kind: &'static str,
    /// The offending value.
    pub value: String,
}

impl ParseEnumError {
    fn new(kind: &'static str, value: &str) -> Self {
        Self {
            kind,
            value: value.to_string(),
        }
    }
}

/// The high-level definition of an AI projection.
///
/// Keyed by a frontend-defined text `id`. Multiple users share a single
/// definition; each user's materialized instance is a [`UserAiProjection`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiProjection {
    /// The frontend-defined identifier (e.g. `notification_important_widget`).
    pub id: String,
    /// The prompt used to materialize the projection.
    pub prompt: String,
    /// A hash of the prompt, used to version cached instances.
    pub prompt_hash: String,
    /// Whether this projection is materialized per user or per team.
    pub target_type: TargetType,
    /// How frequently the projection should be regenerated.
    pub refresh_cadence: RefreshCadence,
    /// How long the projection remains active without being requested.
    pub expiry: Expiry,
    /// When the definition was created.
    pub created_at: DateTime<Utc>,
    /// When the definition was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A per-target cached instance of an [`AiProjection`], identified by its
/// `(target_id, ai_projection_id)` pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserAiProjection {
    /// The id of the projection definition this instance materializes.
    pub ai_projection_id: String,
    /// The target this instance belongs to (a user id or a team id, per the
    /// parent projection's `target_type`).
    pub target_id: String,
    /// The prompt hash at the time the instance was created.
    pub prompt_hash: String,
    /// The materialization status.
    pub status: ProjectionStatus,
    /// The cached result, if any. A plain string for now.
    pub result: Option<String>,
    /// An error message, if materialization failed.
    pub error: Option<String>,
    /// When the result was generated.
    pub generated_at: Option<DateTime<Utc>>,
    /// When the result becomes stale.
    pub stale_at: Option<DateTime<Utc>>,
}

/// Parameters for getting or creating a projection and the requesting user's
/// instance of it.
#[derive(Debug, Clone)]
pub struct UpsertProjectionParams {
    /// The frontend-defined projection id.
    pub id: String,
    /// The prompt used to materialize the projection.
    pub prompt: String,
    /// Whether the projection is materialized for the requesting user or their
    /// team. The concrete target id is resolved from the authenticated user.
    pub target_type: TargetType,
    /// How frequently the projection should be regenerated.
    pub refresh_cadence: RefreshCadence,
    /// How long the projection remains active without being requested.
    pub expiry: Expiry,
}

/// Errors for ai projection storage operations.
#[derive(Debug, thiserror::Error)]
pub enum AiProjectionError {
    /// The projection does not exist.
    #[error("the projection does not exist")]
    NotFound,
    /// The request was invalid.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// A stored value could not be parsed into a domain type.
    #[error("invalid stored data: {0}")]
    InvalidStoredData(#[from] ParseEnumError),
    /// Storage layer error.
    #[error("storage layer error: {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for the get-or-create projection operation.
#[derive(Debug, thiserror::Error)]
pub enum UpsertProjectionError {
    /// The request was invalid.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// Underlying storage error.
    #[error(transparent)]
    AiProjectionError(#[from] AiProjectionError),
}
