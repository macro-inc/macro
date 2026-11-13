//! Wake telemetry routes for agent accounts (`agent_wakes`), wired to MacroDB,
//! the session changes bucket (traces are agent session content, under the
//! `agent-wakes/` prefix) and the `enable-agent-dashboards` flag.

use agent_wakes::domain::ports::DashboardsRollout;
use agent_wakes::domain::service::AgentWakesService;
use agent_wakes::inbound::axum_router::{AgentWakesRouterState, agent_wakes_router};
use agent_wakes::outbound::SystemClock;
use agent_wakes::outbound::postgres::PgWakeRepository;
use agent_wakes::outbound::rollout::{FlaggedDashboards, LocalDashboardsFlags, NoDashboards};
use agent_wakes::outbound::s3::S3TraceStore;
use axum::Router;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_env::Environment;
use sqlx::PgPool;

/// The wake routes. Local stacks have the flag on for everyone; a deployed
/// service without a flag evaluator has it off.
pub(crate) fn router<Auth: MacroAuthorizationService>(
    environment: Environment,
    flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
    pool: PgPool,
    s3: aws_sdk_s3::Client,
    bucket: String,
    authorization: MacroAuthorizationState<Auth>,
) -> Router {
    let repository = PgWakeRepository::new(pool);
    let traces = S3TraceStore::new(s3, bucket);

    match (environment, flags) {
        (Environment::Local, _) => routes(
            repository,
            traces,
            FlaggedDashboards(LocalDashboardsFlags),
            authorization,
        ),
        (_, Some(flags)) => routes(repository, traces, FlaggedDashboards(flags), authorization),
        (_, None) => routes(repository, traces, NoDashboards, authorization),
    }
}

fn routes<Rollout: DashboardsRollout, Auth: MacroAuthorizationService>(
    repository: PgWakeRepository,
    traces: S3TraceStore,
    rollout: Rollout,
    authorization: MacroAuthorizationState<Auth>,
) -> Router {
    agent_wakes_router(AgentWakesRouterState::new(
        AgentWakesService::new(repository, traces, rollout, SystemClock),
        authorization,
    ))
}
