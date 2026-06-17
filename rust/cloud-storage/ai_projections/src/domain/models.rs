//! Domain models for AI projections.

use chrono::{DateTime, Duration, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

/// Toolset version included in every prompt hash.
pub const DEFAULT_TOOLSET_VERSION: &str = "ai_projections.default_toolset.v1";

/// Result type for AI projection domain operations.
pub type Result<T> = std::result::Result<T, ProjectionError>;

/// Errors returned by the AI projection domain.
#[derive(Debug, Error)]
pub enum ProjectionError {
    /// A projection id was blank.
    #[error("projection id cannot be empty")]
    EmptyProjectionId,
    /// A projection prompt was blank.
    #[error("projection prompt cannot be empty")]
    EmptyPrompt,
    /// A target id was blank.
    #[error("projection target id cannot be empty")]
    EmptyTargetId,
    /// The caller requested a different user's projection.
    #[error("user target {target_user_id} does not match requester {requester_user_id}")]
    UserTargetMismatch {
        /// Authenticated requesting user id.
        requester_user_id: String,
        /// Requested target user id.
        target_user_id: String,
    },
    /// The caller is not authorized for a team projection target.
    #[error("user {user_id} is not authorized for team target {team_id}")]
    UnauthorizedTeamTarget {
        /// Authenticated requesting user id.
        user_id: String,
        /// Requested team target id.
        team_id: String,
    },
    /// A repository port returned an error.
    #[error(transparent)]
    Repository(#[from] anyhow::Error),
    /// A publisher port returned an error.
    #[error("projection generation enqueue failed: {0}")]
    Publisher(anyhow::Error),
    /// A generator port returned an error.
    #[error("projection generation failed: {0}")]
    Generator(anyhow::Error),
}

/// A projection materialization target.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Target {
    /// A projection scoped to a single user.
    User {
        /// Macro user id for the user target.
        id: String,
    },
    /// A projection scoped to a team.
    Team {
        /// Team id for the team target.
        id: String,
    },
}

impl Target {
    /// Build a user target.
    pub fn user(id: impl Into<String>) -> Self {
        Self::User { id: id.into() }
    }

    /// Build a team target.
    pub fn team(id: impl Into<String>) -> Self {
        Self::Team { id: id.into() }
    }

    /// Return the stable target type string used in storage.
    pub fn target_type(&self) -> &'static str {
        match self {
            Self::User { .. } => "user",
            Self::Team { .. } => "team",
        }
    }

    /// Return the target id.
    pub fn id(&self) -> &str {
        match self {
            Self::User { id } | Self::Team { id } => id,
        }
    }

    /// Return true when this target is for the given user id.
    pub fn is_user_target_for(&self, user_id: &MacroUserIdStr<'_>) -> bool {
        match self {
            Self::User { id } => id == user_id.as_ref(),
            Self::Team { .. } => false,
        }
    }
}

/// How frequently an active projection should be refreshed.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefreshCadence {
    /// Refresh approximately hourly.
    High,
    /// Refresh approximately every six hours.
    Medium,
    /// Refresh approximately daily.
    Low,
}

impl RefreshCadence {
    /// Return the storage value for this cadence.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }

    /// Return the duration after generation when this projection becomes stale.
    pub fn duration(self) -> Duration {
        match self {
            Self::High => Duration::hours(1),
            Self::Medium => Duration::hours(6),
            Self::Low => Duration::hours(24),
        }
    }

    /// Compute the stale timestamp for a generation time.
    pub fn stale_at(self, generated_at: DateTime<Utc>) -> DateTime<Utc> {
        generated_at + self.duration()
    }
}

/// How long a projection remains active without being requested.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectionExpiry {
    /// Expire after one day without access.
    #[default]
    Day,
    /// Expire after one week without access.
    Week,
    /// Expire after roughly one month without access.
    Month,
}

impl ProjectionExpiry {
    /// Return the storage value for this expiry.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }

    /// Return the inactivity duration before this projection expires.
    pub fn duration(self) -> Duration {
        match self {
            Self::Day => Duration::days(1),
            Self::Week => Duration::days(7),
            Self::Month => Duration::days(30),
        }
    }

    /// Compute the expiry timestamp from the last requested time.
    pub fn expires_at(self, last_requested_at: DateTime<Utc>) -> DateTime<Utc> {
        last_requested_at + self.duration()
    }
}

/// Backend status for a materialized projection.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectionStatus {
    /// The projection has no cached output yet.
    Cold,
    /// The projection has fresh cached output.
    Ready,
    /// The projection has cached output while a refresh is due or running.
    Refreshing,
    /// The last generation attempt failed.
    Error,
}

impl ProjectionStatus {
    /// Return the storage value for this status.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cold => "cold",
            Self::Ready => "ready",
            Self::Refreshing => "refreshing",
            Self::Error => "error",
        }
    }
}

/// Durable cache key for a projection instance.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProjectionCacheKey {
    /// Frontend-defined projection id.
    pub projection_id: String,
    /// Target the projection is scoped to.
    pub target: Target,
    /// Hash of the prompt, context, schema, and toolset version.
    pub prompt_hash: String,
}

/// Request body for lazily materializing an AI projection.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeProjectionRequest {
    /// Frontend-defined projection id.
    pub id: String,
    /// Projection target.
    pub target: Target,
    /// Prompt used to generate the projection.
    pub prompt: String,
    /// Optional frontend context appended to the generation request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Refresh cadence for active cached output.
    pub refresh_cadence: RefreshCadence,
    /// Inactivity expiry window for this projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiry: Option<ProjectionExpiry>,
    /// Optional schema metadata for future structured output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    /// Force a background refresh even when cached output is fresh.
    #[serde(default)]
    pub force_refresh: bool,
}

impl MaterializeProjectionRequest {
    /// Return the request expiry or the default expiry.
    pub fn expiry_or_default(&self) -> ProjectionExpiry {
        self.expiry.unwrap_or_default()
    }

    /// Build the cache key for this request.
    pub fn cache_key(&self) -> AiProjectionCacheKey {
        AiProjectionCacheKey {
            projection_id: self.id.clone(),
            target: self.target.clone(),
            prompt_hash: prompt_hash(&self.prompt, self.context.as_deref(), self.schema.as_ref()),
        }
    }
}

/// Response returned by the backend materialization endpoint.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeProjectionResponse {
    /// Current backend status.
    pub status: ProjectionStatus,
    /// Cached projection output when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    /// Last generation error when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// When the current output was generated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<DateTime<Utc>>,
    /// When the current output becomes stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_at: Option<DateTime<Utc>>,
}

/// Stored projection instance.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionInstance {
    /// Database id for this instance.
    pub id: Uuid,
    /// Durable cache key.
    pub cache_key: AiProjectionCacheKey,
    /// Prompt used for generation.
    pub prompt: String,
    /// Optional frontend context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Optional schema metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    /// User id whose tool context should be used for generation.
    pub generation_user_id: MacroUserIdStr<'static>,
    /// Refresh cadence for this instance.
    pub refresh_cadence: RefreshCadence,
    /// Inactivity expiry window for this instance.
    pub expiry: ProjectionExpiry,
    /// Stored generation status.
    pub status: ProjectionStatus,
    /// Latest generated output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Latest generation error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// When output was generated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<DateTime<Utc>>,
    /// When output becomes stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_at: Option<DateTime<Utc>>,
    /// Next time this projection is eligible for refresh.
    pub next_refresh_at: DateTime<Utc>,
    /// When a worker claimed this instance, if currently claimed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<DateTime<Utc>>,
    /// Last time a user requested this projection.
    pub last_requested_at: DateTime<Utc>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last update timestamp.
    pub updated_at: DateTime<Utc>,
}

impl ProjectionInstance {
    /// Build a cold instance from an upsert request.
    pub fn cold(id: Uuid, request: &UpsertProjectionInstanceRequest) -> Self {
        Self {
            id,
            cache_key: request.cache_key.clone(),
            prompt: request.prompt.clone(),
            context: request.context.clone(),
            schema: request.schema.clone(),
            generation_user_id: request.generation_user_id.clone(),
            refresh_cadence: request.refresh_cadence,
            expiry: request.expiry,
            status: ProjectionStatus::Cold,
            output: None,
            error: None,
            generated_at: None,
            stale_at: None,
            next_refresh_at: request.requested_at,
            claimed_at: None,
            last_requested_at: request.requested_at,
            created_at: request.requested_at,
            updated_at: request.requested_at,
        }
    }

    /// Return true when an output is cached.
    pub fn has_output(&self) -> bool {
        self.output.is_some()
    }

    /// Return true when cached output is stale at the provided time.
    pub fn is_stale(&self, now: DateTime<Utc>) -> bool {
        self.stale_at
            .as_ref()
            .is_some_and(|stale_at| *stale_at <= now)
    }

    /// Build the generation request for this instance.
    pub fn generation_request(&self) -> GenerateProjectionRequest {
        GenerateProjectionRequest {
            cache_key: self.cache_key.clone(),
            prompt: self.prompt.clone(),
            context: self.context.clone(),
            schema: self.schema.clone(),
            generation_user_id: self.generation_user_id.clone(),
        }
    }
}

/// Repository input for creating or touching a projection instance.
#[derive(Clone, Debug, PartialEq)]
pub struct UpsertProjectionInstanceRequest {
    /// Durable cache key for the instance.
    pub cache_key: AiProjectionCacheKey,
    /// Prompt to persist for generation.
    pub prompt: String,
    /// Optional frontend context to persist.
    pub context: Option<String>,
    /// Optional schema metadata to persist.
    pub schema: Option<Value>,
    /// User id whose tool context should be used for generation.
    pub generation_user_id: MacroUserIdStr<'static>,
    /// Refresh cadence for active cached output.
    pub refresh_cadence: RefreshCadence,
    /// Inactivity expiry window.
    pub expiry: ProjectionExpiry,
    /// Time of the materialization request.
    pub requested_at: DateTime<Utc>,
}

impl UpsertProjectionInstanceRequest {
    /// Build an upsert request from a materialization request.
    pub fn from_materialize_request(
        request: &MaterializeProjectionRequest,
        generation_user_id: MacroUserIdStr<'static>,
        requested_at: DateTime<Utc>,
    ) -> Self {
        Self {
            cache_key: request.cache_key(),
            prompt: request.prompt.clone(),
            context: request.context.clone(),
            schema: request.schema.clone(),
            generation_user_id,
            refresh_cadence: request.refresh_cadence,
            expiry: request.expiry_or_default(),
            requested_at,
        }
    }
}

/// Reason a projection was scheduled for generation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleGenerationReason {
    /// No cached output exists yet.
    #[serde(rename = "initial")]
    ColdStart,
    /// Cached output is stale.
    #[serde(rename = "refresh")]
    Stale,
    /// The caller explicitly requested a refresh.
    ForceRefresh,
    /// A previous generation attempt failed and is due for retry.
    Retry,
}

/// Event published when a projection should be generated.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProjectionGenerationRequested {
    /// Durable cache key for the projection instance to generate.
    pub cache_key: AiProjectionCacheKey,
    /// Why generation was requested.
    pub reason: ScheduleGenerationReason,
    /// User that requested or triggered this generation request.
    pub requested_by: MacroUserIdStr<'static>,
    /// User whose tool context should be used for generation.
    pub generation_user_id: MacroUserIdStr<'static>,
    /// Time the event was enqueued.
    pub enqueued_at: DateTime<Utc>,
}

/// Repository input for scheduling generation work.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduleProjectionRequest {
    /// Durable cache key for the instance.
    pub cache_key: AiProjectionCacheKey,
    /// User id that requested or triggered generation.
    pub requested_by: MacroUserIdStr<'static>,
    /// Reason generation is being scheduled.
    pub reason: ScheduleGenerationReason,
    /// Time generation was scheduled.
    pub scheduled_at: DateTime<Utc>,
}

/// Repository input for claiming a queued projection generation message.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimProjectionGenerationRequest {
    /// Durable cache key for the queued generation request.
    pub cache_key: AiProjectionCacheKey,
    /// User whose tool context should be used for generation.
    pub generation_user_id: MacroUserIdStr<'static>,
    /// Time the queue message was enqueued.
    pub enqueued_at: DateTime<Utc>,
    /// Time this worker is attempting to claim the instance.
    pub claimed_at: DateTime<Utc>,
}

/// Result of attempting to claim a queued projection generation message.
#[derive(Clone, Debug, PartialEq)]
pub enum ClaimProjectionGenerationResult {
    /// The projection was claimed and should be generated by this worker.
    Claimed(Box<ProjectionInstance>),
    /// No projection instance exists for the queued cache key.
    NotFound,
    /// The projection instance exists but is no longer active.
    Expired,
    /// Another worker currently owns a fresh claim for the instance.
    AlreadyClaimed,
    /// The queued message has already been handled by a newer success or failure.
    Superseded,
}

/// Repository input for releasing an enqueue-only claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleaseProjectionClaimRequest {
    /// Durable cache key whose claim should be released.
    pub cache_key: AiProjectionCacheKey,
    /// Time the claim was released.
    pub released_at: DateTime<Utc>,
}

/// Raw message received from the projection generation queue.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawProjectionGenerationMessage {
    /// SQS message id when available.
    pub message_id: Option<String>,
    /// Raw JSON message body.
    pub body: Option<String>,
    /// SQS receipt handle used to delete the message.
    pub receipt_handle: Option<String>,
}

/// Input for completing a generation attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompleteProjectionRequest {
    /// Durable cache key for the instance.
    pub cache_key: AiProjectionCacheKey,
    /// Generated output.
    pub output: String,
    /// Time generation completed.
    pub generated_at: DateTime<Utc>,
}

/// Input for recording a failed generation attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FailProjectionRequest {
    /// Durable cache key for the instance.
    pub cache_key: AiProjectionCacheKey,
    /// Error message to persist.
    pub error: String,
    /// Time generation failed.
    pub failed_at: DateTime<Utc>,
}

/// Request sent to the expensive projection generator.
#[derive(Clone, Debug, PartialEq)]
pub struct GenerateProjectionRequest {
    /// Durable cache key for the instance.
    pub cache_key: AiProjectionCacheKey,
    /// Prompt used for generation.
    pub prompt: String,
    /// Optional frontend context.
    pub context: Option<String>,
    /// Optional schema metadata.
    pub schema: Option<Value>,
    /// User id whose tool context should be used for generation.
    pub generation_user_id: MacroUserIdStr<'static>,
}

/// Successful generator output.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GeneratedProjection {
    /// Materialized projection output.
    pub output: String,
}

/// Compute the stable prompt hash for a projection definition.
pub fn prompt_hash(prompt: &str, context: Option<&str>, schema: Option<&Value>) -> String {
    let mut hasher = Sha256::new();
    write_hash_field(
        &mut hasher,
        "toolset_version",
        Some(DEFAULT_TOOLSET_VERSION.as_bytes()),
    );
    write_hash_field(&mut hasher, "prompt", Some(prompt.as_bytes()));
    write_hash_field(&mut hasher, "context", context.map(str::as_bytes));

    let schema_json = schema.map(Value::to_string);
    write_hash_field(
        &mut hasher,
        "schema",
        schema_json.as_deref().map(str::as_bytes),
    );

    hex::encode(hasher.finalize())
}

fn write_hash_field(hasher: &mut Sha256, name: &str, value: Option<&[u8]>) {
    hasher.update(name.as_bytes());
    hasher.update(b"\0");

    match value {
        Some(bytes) => {
            hasher.update(b"1");
            hasher.update(bytes.len().to_be_bytes());
            hasher.update(bytes);
        }
        None => hasher.update(b"0"),
    }

    hasher.update(b"\0");
}
