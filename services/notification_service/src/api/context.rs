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
pub(crate) type SectionSettings =
    notification::domain::section_settings::SectionNotificationSettingsService<
        notification::outbound::section_settings::PgSectionNotificationSettingsRepository,
    >;
pub(crate) type ChannelSettings =
    notification::domain::channel_settings::ChannelNotificationSettingsService<
        notification::outbound::channel_settings::PgChannelNotificationSettingsRepository,
    >;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    /// Signed invocation validation and propagation.
    pub correlation: agent_correlation::inbound::CorrelationState,
    pub item_preferences: ItemPreferences,
    pub channel_settings: ChannelSettings,
    pub section_settings: SectionSettings,
    pub db: PgPool,
    pub sns_client: Arc<sns_client::SNS>,
    pub config: Arc<Config>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub internal_api_key: InternalApiKey,
}
