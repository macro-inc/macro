use axum::extract::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    outbound::postgres::{comms_repo::PgCommsRepo, user_repo::PgUserRepo},
};
use email::{domain::service::EmailServiceImpl, outbound::EmailPgRepo};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use soup::{
    domain::service::SoupImpl, inbound::toolset::SoupToolContext,
    outbound::pg_soup_repo::PgSoupRepo,
};
use std::sync::Arc;

pub use ai_toolset::RequestContext;

pub type ToolScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

/// Type alias for the frecency service implementation
pub type ToolFrecencyService = FrecencyQueryServiceImpl<FrecencyPgStorage>;

/// Type alias for the email service implementation
pub type ToolEmailService = EmailServiceImpl<
    EmailPgRepo,
    ToolFrecencyService,
    email::domain::ports::NoOpEnqueuer,
    email::domain::ports::NoOpGmailLabelModifier,
>;

/// Type alias for the comms/channels service implementation
pub type ToolCommsService = ChannelServiceImpl<PgCommsRepo, PgUserRepo, FrecencyPgStorage>;

/// Type alias for the soup service implementation
pub type ToolSoupService =
    SoupImpl<PgSoupRepo, ToolFrecencyService, ToolEmailService, ToolCommsService>;

/// The full service context containing all API clients.
/// Individual tools should extract only the clients they need via `FromRef`.
#[derive(Clone, FromRef)]
pub struct ToolServiceContext {
    pub search_service_client: Arc<search_service_client::SearchServiceClient>,
    pub email_service_client: Arc<email_service_client::EmailServiceClientExternal>,
    pub scribe: Arc<ToolScribe>,
    pub soup_service: Arc<ToolSoupService>,
}

impl FromRef<ToolServiceContext> for ai_toolset::NoContext {
    fn from_ref(_ctx: &ToolServiceContext) -> Self {
        ai_toolset::NoContext()
    }
}

impl FromRef<ToolServiceContext> for SoupToolContext<ToolSoupService> {
    fn from_ref(ctx: &ToolServiceContext) -> Self {
        SoupToolContext {
            service: ctx.soup_service.clone(),
        }
    }
}
