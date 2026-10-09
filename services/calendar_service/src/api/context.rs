use std::sync::Arc;

use calendar_events::{
    domain::{mutations::CalendarMutationServiceImpl, service::CalendarService},
    outbound::{google::GoogleCalendarClient, pg::PgCalendarRepository},
};
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};

use crate::calendar_backfill::CalendarEventBroker;
use crate::calendar_backfill_adapters::RedisCalendarRequestGate;
use crate::calendar_refresh::ConnectionGatewayCalendarRefresh;
use crate::calendar_tokens::CalendarTokenProviderAdapter;
use crate::config::Config;

/// JWT-validating authorization service used by the mutation routes.
pub type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;
/// Calendar grant/watch service backing the push webhook.
pub type CalendarGrantService = CalendarService<PgCalendarRepository>;
/// Team-sharing policy service with viewer refresh notifications.
pub type CalendarTeamSvc = calendar_events::domain::team::CalendarTeamServiceImpl<
    calendar_events::outbound::pg_team::PgCalendarTeamRepository,
    ConnectionGatewayCalendarRefresh,
>;
/// Booking policy backed by calendar services and the team directory.
pub type SchedulingService = calendar_scheduling::domain::service::Service<
    calendar_scheduling::outbound::postgres::PostgresRepository,
    calendar_scheduling::outbound::macro_services::MacroCalendars<
        CalendarGrantService,
        CalendarMutationSvc,
    >,
    calendar_scheduling::outbound::macro_services::MacroDirectory<
        teams::outbound::team_repo::TeamRepositoryImpl,
    >,
>;
/// User-initiated calendar mutation service.
pub type CalendarMutationSvc = CalendarMutationServiceImpl<
    PgCalendarRepository,
    GoogleCalendarClient<RedisCalendarRequestGate>,
    CalendarTokenProviderAdapter,
    CalendarEventBroker,
    ConnectionGatewayCalendarRefresh,
>;

/// Shared HTTP application state for the calendar service.
#[derive(Clone)]
pub struct ApiContext {
    /// Resolved service configuration.
    pub config: Arc<Config>,
    /// Authorization state for authenticated mutation routes.
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    /// Calendar grant/watch service backing the push webhook.
    pub calendar_service: Arc<CalendarGrantService>,
    /// User-initiated calendar mutation service.
    pub calendar_mutation_service: Arc<CalendarMutationSvc>,
    /// Read-only team-sharing preferences and personal availability inclusion.
    pub calendar_team_service: Arc<CalendarTeamSvc>,
    /// Personal and team scheduling service.
    pub scheduling_service: Arc<SchedulingService>,
}
