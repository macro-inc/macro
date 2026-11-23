//! Composition of the time tools from the time tracking domain, wired as
//! document storage wires its time routes.

use super::*;
use time_tracking::{
    domain::{ports::TimeTrackingRollout, service::TimeTrackingServiceImpl},
    inbound::toolset::TimeTrackingToolContext,
    outbound::{
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
>;

/// Context of `LogTime` and `ReadTimeEntries`.
pub type ToolTimeTrackingToolContext =
    TimeTrackingToolContext<ToolTimeTrackingService, ToolEntityAccessService>;

/// Compose the time tools. Writes follow each user's `enable-time-tracking`
/// flag, on for everyone on a local stack and off on a host without a flag
/// client, as in document storage.
pub fn build_time_tracking_tool_context(
    pool: sqlx::PgPool,
    access: Arc<ToolEntityAccessService>,
    event_broker: ToolEventBroker,
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
        )),
        access,
    }
}
