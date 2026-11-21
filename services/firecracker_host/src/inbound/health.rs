//! `GET /health`: whether the host can take computers now. 200 with the
//! checks when ready, 503 with them when not. Served on the agent's mTLS
//! listener like the rest of the API.

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;

use crate::domain::health::HealthReport;
use crate::domain::ports::{Disks, Goldens, Machines, Store};
use crate::domain::service::{HostProbe, HostService};
use crate::outbound::host_checks::HostChecks;

/// The path.
pub const HEALTH: &str = "/health";

/// What `/health` reads.
pub struct Health<S, D, G, M, P> {
    /// The agent.
    pub service: Arc<HostService<S, D, G, M, P>>,
    /// The host's checks.
    pub checks: HostChecks,
}

impl<S, D, G, M, P> Health<S, D, G, M, P>
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    /// Run every check now.
    pub async fn report(&self) -> (HealthReport, Option<crate::domain::metrics::StorageUsage>) {
        let host = self.checks.run().await;
        let mut checks = self.service.service_checks();
        checks.extend(host.checks);
        (HealthReport::new(checks), host.storage)
    }
}

/// The router for `/health`.
pub fn router<S, D, G, M, P>(health: Arc<Health<S, D, G, M, P>>) -> Router
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    Router::new()
        .route(HEALTH, get(health_report::<S, D, G, M, P>))
        .with_state(health)
}

type HealthState<S, D, G, M, P> = State<Arc<Health<S, D, G, M, P>>>;

async fn health_report<S, D, G, M, P>(
    State(health): HealthState<S, D, G, M, P>,
) -> (StatusCode, Json<HealthReport>)
where
    S: Store,
    D: Disks,
    G: Goldens,
    M: Machines,
    P: HostProbe,
{
    let (report, _) = health.report().await;
    let status = if report.ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(report))
}
