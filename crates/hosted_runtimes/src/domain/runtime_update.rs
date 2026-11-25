//! A manually requested service-only update for one dev teammate.

use std::future::Future;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::domain::ids::ComputerId;

/// The request and its presigned, short-lived download URL.
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeBundle {
    pub(crate) version: String,
    pub(crate) digest: String,
    pub(crate) url: String,
}

impl RuntimeBundle {
    /// Check the format before recording or running a remote request.
    pub fn valid(&self) -> bool {
        let hex = |value: &str, len| {
            value.len() == len
                && value
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        };
        if !hex(&self.version, 40) || !hex(&self.digest, 64) || self.url.len() > 8192 {
            return false;
        }
        let Ok(url) = Url::parse(&self.url) else {
            return false;
        };
        let suffix = format!("/agent-runtime-bundles/{}/runtime.tar.zst", self.version);
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| host.ends_with(".amazonaws.com"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.fragment().is_none()
            && url.path().ends_with(&suffix)
            && url.query_pairs().any(|(key, _)| key == "X-Amz-Signature")
    }
}

/// Terminal outcome; guest diagnostics remain in its service journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum RuntimeUpdateOutcome {
    /// The requested digest is running and chat is ready.
    Applied,
    /// The guest or control plane refused the request before replacing it.
    Refused,
    /// The previous runtime came back ready.
    RolledBack,
    /// The previous runtime was selected but failed readiness.
    RollbackFailed,
    /// No remaining attempt could fit before the deadline.
    Expired,
}

/// A claimed update.
pub struct RuntimeUpdate {
    /// Stable request id.
    pub id: Uuid,
    /// The single computer to update.
    pub computer: ComputerId,
    /// Immutable bundle identity and download source.
    pub bundle: RuntimeBundle,
    /// Upper bound on retries.
    pub deadline: DateTime<Utc>,
    /// Whether a previous lease may already have reached the guest.
    pub attempted: bool,
}

/// Runtime update request storage.
pub trait RuntimeUpdates: Send + Sync {
    /// Storage error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Record a valid request for an eligible, unheld teammate.
    fn request_runtime_update(
        &self,
        computer: ComputerId,
        bundle: &RuntimeBundle,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Read the terminal state by id. `None` means it is still pending.
    fn runtime_update_outcome(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<RuntimeUpdateOutcome>, Self::Err>> + Send;

    /// Claim one due request, including a request that needs to expire.
    fn claim_runtime_update(
        &self,
        holder: Uuid,
        lease: Duration,
    ) -> impl Future<Output = Result<Option<RuntimeUpdate>, Self::Err>> + Send;

    /// Publish a terminal outcome only under the lease that ran the request.
    fn finish_runtime_update(
        &self,
        holder: Uuid,
        id: Uuid,
        outcome: RuntimeUpdateOutcome,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// A host's fixed guest runtime update operation.
pub trait GuestRuntimeUpdate: Send + Sync {
    /// A transport error leaves the result unknown and the lease intact.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Run the image's updater and wait for verification or rollback.
    fn update_guest_runtime(
        &self,
        computer: ComputerId,
        bundle: &RuntimeBundle,
    ) -> impl Future<Output = Result<RuntimeUpdateOutcome, Self::Err>> + Send;
    /// Confirm there is no live transaction or recovery in the guest.
    fn runtime_update_settled(
        &self,
        computer: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
