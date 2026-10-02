use std::sync::Arc;

use authentication_service_client::AuthServiceClient;
use email_api_client::{GmailApiClientRepository, domain::service::EmailApiClientServiceImpl};
use email_service::{
    inbox_owner::InboxOwnerService,
    outbound::{
        email_api::{EmailServiceTokenSource, RedisProviderRateLimiter},
        inbox_owner::PgInboxOwners,
    },
};

use crate::api::context::{ApiContext, CalendarGrantService, EmailEventBroker};

/// Dependencies used by initialization, separated from unrelated API state so
/// recovery tests can replace external ports while executing the production flow.
pub(super) struct InitContext<
    T = EmailServiceTokenSource,
    L = RedisProviderRateLimiter,
    B = EmailEventBroker,
> {
    pub db: sqlx::PgPool,
    pub inbox_owners: InboxOwnerService<PgInboxOwners>,
    pub auth_service_client: Arc<AuthServiceClient>,
    pub email_api: EmailApiClientServiceImpl<GmailApiClientRepository, T, L>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub macro_event_broker: Arc<B>,
    pub calendar_service: Arc<CalendarGrantService>,
}

impl From<ApiContext> for InitContext {
    fn from(ctx: ApiContext) -> Self {
        Self {
            db: ctx.db,
            inbox_owners: ctx.inbox_owners,
            auth_service_client: ctx.auth_service_client,
            email_api: ctx.email_api,
            sqs_client: ctx.sqs_client,
            macro_event_broker: ctx.macro_event_broker,
            calendar_service: ctx.calendar_service,
        }
    }
}
