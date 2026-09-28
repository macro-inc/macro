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
}
