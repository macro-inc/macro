//! Durable optimistic-mutation queue models.
//!
//! The cache engine owns mutation ordering and optimistic composition; storage
//! backends persist these transport-neutral values atomically. Authentication
//! credentials and urql operation context are deliberately excluded: replay
//! reconstructs an operation using the current client configuration.

use crate::link_patch::{OptimisticLinkPatch, QueryRevalidation};
use crate::normalize::RecordUpdates;
use crate::value::canonical_json;
use predicate_index::OptimisticProjectionMutation;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use uuid::Uuid;

/// Durable, monotonically increasing mutation identifier and queue position.
pub type MutationId = u64;

/// The serializable portion of a GraphQL mutation needed for replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationRequest {
    /// GraphQL mutation document text.
    pub query: String,
    /// Selected operation when the document contains named operations.
    pub operation_name: Option<String>,
    /// Canonical JSON object containing the mutation variables.
    pub variables_json: String,
    /// Opaque identity witness bound when the mutation was enqueued.
    pub identity: Option<String>,
}

/// Persisted retry and lease state for one queued mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredMutation {
    /// Replayable GraphQL request.
    pub request: MutationRequest,
    /// Number of times this mutation has been claimed for a network attempt.
    pub attempt_count: u32,
    /// Earliest wall-clock time at which the head may be claimed again.
    pub next_attempt_at_ms: Option<i64>,
    /// Owner of the current claim, if any.
    pub lease_owner: Option<String>,
    /// Monotonic generation used to reject stale attempt results.
    pub lease_generation: u64,
    /// Time at which the current claim becomes available to another owner.
    pub lease_expires_at_ms: Option<i64>,
    /// Last retryable network error, for diagnostics.
    pub last_error: Option<String>,
    /// Wall-clock enqueue time, for diagnostics.
    pub created_at_ms: i64,
}

impl StoredMutation {
    /// Creates an unclaimed queue row for `request`.
    pub fn new(request: MutationRequest, created_at_ms: i64) -> Self {
        Self {
            request,
            attempt_count: 0,
            next_attempt_at_ms: None,
            lease_owner: None,
            lease_generation: 0,
            lease_expires_at_ms: None,
            last_error: None,
            created_at_ms,
        }
    }
}

/// Current version of the durable optimistic source envelope.
pub const OPTIMISTIC_SOURCE_VERSION: u8 = 3;

const OPTIMISTIC_SOURCE_ENVELOPE_PREFIX: &str = "@macro-cache/optimistic-source:";

/// Durable source needed to reconstruct one optimistic layer statefully.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimisticSource {
    /// Optimistic GraphQL mutation response.
    pub mutation_data: Json,
    /// Ordered constrained relation recipes.
    #[serde(default)]
    pub link_patches: Vec<OptimisticLinkPatch>,
    /// Revalidations for relevant fields that could not be patched.
    #[serde(default)]
    pub revalidations: Vec<QueryRevalidation>,
    /// Ordered generic projection changes composed with this optimistic layer.
    #[serde(default)]
    pub projection_mutations: Vec<OptimisticProjectionMutation>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimisticSourceEnvelope {
    version: u8,
    mutation_data: Json,
    #[serde(default)]
    link_patches: Vec<OptimisticLinkPatch>,
    #[serde(default)]
    revalidations: Vec<QueryRevalidation>,
    projection_mutations: Vec<OptimisticProjectionMutation>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OptimisticSourceEnvelopeV2 {
    version: u8,
    mutation_data: Json,
    #[serde(default)]
    link_patches: Vec<OptimisticLinkPatch>,
    #[serde(default)]
    revalidations: Vec<QueryRevalidation>,
}

/// Encodes an optimistic source with a reserved prefix and versioned JSON envelope.
pub fn encode_optimistic_source(source: &OptimisticSource) -> String {
    let envelope = canonical_json(
        &serde_json::to_value(OptimisticSourceEnvelope {
            version: OPTIMISTIC_SOURCE_VERSION,
            mutation_data: source.mutation_data.clone(),
            link_patches: source.link_patches.clone(),
            revalidations: source.revalidations.clone(),
            projection_mutations: source.projection_mutations.clone(),
        })
        .expect("optimistic source serializes"),
    );
    format!("{OPTIMISTIC_SOURCE_ENVELOPE_PREFIX}{envelope}")
}

/// Decodes a versioned optimistic source, treating legacy raw JSON as the
/// optimistic mutation response with no relation recipes.
pub fn decode_optimistic_source(value: &str) -> Result<OptimisticSource, String> {
    let Some(envelope) = value.strip_prefix(OPTIMISTIC_SOURCE_ENVELOPE_PREFIX) else {
        return Ok(OptimisticSource {
            mutation_data: serde_json::from_str(value).map_err(|error| error.to_string())?,
            link_patches: Vec::new(),
            revalidations: Vec::new(),
            projection_mutations: Vec::new(),
        });
    };
    let value: Json = serde_json::from_str(envelope).map_err(|error| error.to_string())?;
    let version = value
        .get("version")
        .and_then(Json::as_u64)
        .ok_or_else(|| "optimistic source version is missing or invalid".to_string())?;
    match version {
        2 => {
            let envelope: OptimisticSourceEnvelopeV2 =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            debug_assert_eq!(envelope.version, 2);
            Ok(OptimisticSource {
                mutation_data: envelope.mutation_data,
                link_patches: envelope.link_patches,
                revalidations: envelope.revalidations,
                projection_mutations: Vec::new(),
            })
        }
        version if version == u64::from(OPTIMISTIC_SOURCE_VERSION) => {
            let envelope: OptimisticSourceEnvelope =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            Ok(OptimisticSource {
                mutation_data: envelope.mutation_data,
                link_patches: envelope.link_patches,
                revalidations: envelope.revalidations,
                projection_mutations: envelope.projection_mutations,
            })
        }
        version => Err(format!("unsupported optimistic source version {version}")),
    }
}

/// One durable optimistic layer paired one-to-one with a queued mutation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedOptimisticLayer {
    /// Encoded optimistic source, retained for re-normalization after a
    /// record-schema change.
    pub optimistic_data_json: String,
    /// Normalized contribution used to hydrate the effective cache view.
    pub normalized_updates: RecordUpdates,
}

/// A mutation and optimistic layer before storage assigns its queue id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewQueuedMutation {
    /// Caller-supplied coalescing key.
    pub uuid: Uuid,
    /// Mutation request plus initial retry metadata.
    pub mutation: StoredMutation,
    /// Optimistic contribution paired with the mutation.
    pub optimistic: PersistedOptimisticLayer,
}

/// One complete durable queue entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueuedMutation {
    /// Durable queue id and ordering key.
    pub id: MutationId,
    /// Caller-supplied coalescing key.
    pub uuid: Uuid,
    /// Whether a newer mutation superseded this still-active row.
    pub superseded: bool,
    /// Mutation request and retry metadata.
    pub mutation: StoredMutation,
    /// Optimistic contribution paired with the mutation.
    pub optimistic: PersistedOptimisticLayer,
}

/// Queue and lifecycle state used to fence a staged UUID upsert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationQueueSnapshot {
    /// Durable queue id.
    pub id: MutationId,
    /// Caller coalescing key.
    pub uuid: Uuid,
    /// Whether this row has been superseded.
    pub superseded: bool,
    /// Current lease owner.
    pub lease_owner: Option<String>,
    /// Current lease generation.
    pub lease_generation: u64,
    /// Current lease expiry.
    pub lease_expires_at_ms: Option<i64>,
    /// Current retry eligibility time.
    pub next_attempt_at_ms: Option<i64>,
}

impl From<&QueuedMutation> for MutationQueueSnapshot {
    fn from(queued: &QueuedMutation) -> Self {
        Self {
            id: queued.id,
            uuid: queued.uuid,
            superseded: queued.superseded,
            lease_owner: queued.mutation.lease_owner.clone(),
            lease_generation: queued.mutation.lease_generation,
            lease_expires_at_ms: queued.mutation.lease_expires_at_ms,
            next_attempt_at_ms: queued.mutation.next_attempt_at_ms,
        }
    }
}

/// How a UUID-aware enqueue changed the existing queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationUpsertKind {
    /// No current row used this UUID.
    Inserted,
    /// A non-active current row was removed.
    ReplacedPending {
        /// Transaction removed by the replacement.
        removed_id: MutationId,
    },
    /// A live row was retained and marked superseded.
    AppendedAfterActive {
        /// Still-active transaction retained ahead of the replacement.
        active_id: MutationId,
    },
}

/// Result of atomically inserting or replacing a queued mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationUpsertResult {
    /// Fresh queue id assigned to the inserted tail row.
    pub id: MutationId,
    /// Queue collision outcome.
    pub kind: MutationUpsertKind,
}

/// Successful claim of the oldest runnable mutation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaimedMutation {
    /// Claimed queue entry, including updated attempt and lease metadata.
    pub queued: QueuedMutation,
    /// Generation that settlement calls must present.
    pub lease_generation: u64,
}

/// Parameters for claiming the strict queue head.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationClaimRequest {
    /// Stable owner id for one queue runner.
    pub owner: String,
    /// Current wall-clock time.
    pub now_ms: i64,
    /// Absolute expiration time for the new lease.
    pub lease_expires_at_ms: i64,
}

/// Identifies the attempt allowed to settle or defer a mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationClaimToken {
    /// Stable owner id supplied at claim time.
    pub owner: String,
    /// Lease generation returned by the successful claim.
    pub generation: u64,
}
