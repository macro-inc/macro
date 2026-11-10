use crate::config::Config;
use axum::extract::FromRef;
use macro_auth::InternalApiKey;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use sqlx::PgPool;
use std::sync::Arc;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;
pub(crate) type ItemPreferences =
    notification::domain::item_preferences::ItemNotificationPreferenceService<
        notification::outbound::item_preferences::PgItemNotificationPreferenceRepository,
    >;

pub type Stacks = notification_routing::inbound::axum_router::NotificationStackRouterState<
    notification_routing::domain::service::NotificationStackServiceImpl<
        notification_routing::outbound::pg_stack_repo::PgStackRepository,
        crate::stack_flags::StackFlags,
    >,
    AuthorizationService,
>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    /// Signed invocation validation and propagation.
    pub correlation: agent_correlation::inbound::CorrelationState,
    pub item_preferences: ItemPreferences,
    /// A person's notification stacks.
    pub stacks: Stacks,
    pub db: PgPool,
    pub sns_client: Arc<sns_client::SNS>,
    pub config: Arc<Config>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub internal_api_key: InternalApiKey,
}
