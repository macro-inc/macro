//! Host-supplied production policies, with explicit overrides for timing stories.
pub use doc_sync_core::TransportKind;
use doc_sync_core::{
    BackoffPolicy, ConvergePolicy, HeartbeatPolicy, ResetBudget, Timeouts, WalPolicy, WallDuration,
};

/// Policies shared by current-build simulated tab sessions and their physical router.
#[derive(Clone, Debug)]
pub struct SessionDefaults {
    /// Direct socket, shared route, or no live transport.
    pub transport: TransportKind,
    /// Time limits for correlated operations.
    pub timeouts: Timeouts,
    /// Physical connection liveness.
    pub heartbeat: HeartbeatPolicy,
    /// Physical reconnect policy.
    pub backoff: BackoffPolicy,
    /// Convergence retries.
    pub converge: ConvergePolicy,
    /// Coalescing, retry and orphan retention policy.
    pub wal: WalPolicy,
    /// Durable snapshot cadence.
    pub snapshot_interval: Option<doc_sync_core::Millis>,
    /// Receiver-side presence expiry on the injected wall clock.
    pub presence_timeout: WallDuration,
    /// GenericSurface keepalive; AI workers retain their required two-second cadence.
    pub presence_refresh: Option<doc_sync_core::Millis>,
    /// Started corruption reset budget.
    pub reset_budget: ResetBudget,
}
impl Default for SessionDefaults {
    fn default() -> Self {
        Self::production()
    }
}
impl SessionDefaults {
    /// Production core policies and the form world's existing presence settings.
    pub fn production() -> Self {
        Self {
            transport: TransportKind::Direct,
            timeouts: Timeouts::default(),
            heartbeat: HeartbeatPolicy::default(),
            backoff: BackoffPolicy::default(),
            converge: ConvergePolicy::default(),
            wal: WalPolicy::default(),
            snapshot_interval: Some(doc_sync_core::Millis(5000)),
            presence_timeout: WallDuration(5000),
            presence_refresh: Some(doc_sync_core::Millis(3000)),
            reset_budget: ResetBudget::default(),
        }
    }
}
