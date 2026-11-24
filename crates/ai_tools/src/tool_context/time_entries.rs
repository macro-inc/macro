//! Composition of the time tools from the time tracking domain, wired as
//! document storage wires its time routes, so a time an agent logs reaches the
//! person's other open sessions as a REST write does.

use super::*;
use time_tracking::{
    domain::{ports::TimeTrackingRollout, service::TimeTrackingServiceImpl},
    inbound::toolset::TimeTrackingToolContext,
    outbound::{
        gateway_updates::GatewayTimeTrackingUpdates,
        kafka_events::BrokerTimeEntryEventPublisher,
        pg_time_repo::PgTimeTrackingRepository,
        rollout::{FlaggedTimeTracking, LocalTimeTracking, TimeTrackingOff},
    },
};

/// The time tracking service the time tools call.
pub type ToolTimeTrackingService = TimeTrackingServiceImpl<
    PgTimeTrackingRepository,
    ToolEntityAccessService,
    BrokerTimeEntryEventPublisher<ToolEventBroker>,
    GatewayTimeTrackingUpdates,
>;

/// Context of `LogTime` and `ReadTimeEntries`.
pub type ToolTimeTrackingToolContext =
    TimeTrackingToolContext<ToolTimeTrackingService, ToolEntityAccessService>;

/// Compose the time tools. Writes follow each user's `enable-time-tracking`
/// flag, on for everyone on a local stack and off on a host without a flag
/// client, as in document storage. Each write tells the person's open
/// sessions to read their time again through `gateway`, on
/// `session_update_tracker`, which the host drains at shutdown.
pub fn build_time_tracking_tool_context(
    pool: sqlx::PgPool,
    access: Arc<ToolEntityAccessService>,
    event_broker: ToolEventBroker,
    gateway: ConnectionGatewayClient,
    session_update_tracker: TaskTracker,
    environment: macro_env::Environment,
    flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
) -> ToolTimeTrackingToolContext {
    let rollout: Arc<dyn TimeTrackingRollout> = match (environment, flags) {
        (macro_env::Environment::Local, _) => Arc::new(LocalTimeTracking),
        (_, Some(flags)) => Arc::new(FlaggedTimeTracking(flags)),
        (_, None) => Arc::new(TimeTrackingOff),
    };
    TimeTrackingToolContext {
        service: Arc::new(TimeTrackingServiceImpl::new(
            PgTimeTrackingRepository::new(pool),
            access.clone(),
            rollout,
            BrokerTimeEntryEventPublisher::new(event_broker),
            GatewayTimeTrackingUpdates::new(gateway, session_update_tracker),
        )),
        access,
    }
}
