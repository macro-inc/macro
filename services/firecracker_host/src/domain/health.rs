//! Whether the host can take computers now: the answer of `GET /health`
//! and of the `firecracker_host.ready` gauge.

use serde::Serialize;

/// One readiness condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthCheck {
    /// At least one golden is restorable.
    Golden,
    /// The storage computers live on is healthy (ZFS pool `ONLINE`).
    StoragePool,
    /// The agent's nftables tables are loaded.
    Nftables,
    /// Records can be written to the durable disk.
    StoreWritable,
    /// The last reconcile left nothing unresolved.
    Reconcile,
    /// Swap (zram) exists when the host limits ask for the squeeze.
    Swap,
    /// Every sold size's empty `/home` template exists.
    HomeTemplates,
}

impl HealthCheck {
    /// The metric attribute value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Golden => "golden",
            Self::StoragePool => "storage_pool",
            Self::Nftables => "nftables",
            Self::StoreWritable => "store_writable",
            Self::Reconcile => "reconcile",
            Self::Swap => "swap",
            Self::HomeTemplates => "home_templates",
        }
    }
}

/// One check's result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutcome {
    /// Which.
    pub check: HealthCheck,
    /// Whether it passed.
    pub healthy: bool,
    /// Why it failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl CheckOutcome {
    /// A passed check.
    pub fn passed(check: HealthCheck) -> Self {
        Self {
            check,
            healthy: true,
            detail: None,
        }
    }

    /// A failed check and why.
    pub fn failed(check: HealthCheck, detail: impl Into<String>) -> Self {
        Self {
            check,
            healthy: false,
            detail: Some(detail.into()),
        }
    }
}

/// Every check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    /// Every check passed.
    pub ready: bool,
    /// Each check.
    pub checks: Vec<CheckOutcome>,
}

impl HealthReport {
    /// Ready when every check passed.
    pub fn new(checks: Vec<CheckOutcome>) -> Self {
        Self {
            ready: checks.iter().all(|check| check.healthy),
            checks,
        }
    }
}
