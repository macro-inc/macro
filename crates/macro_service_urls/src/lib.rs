#![deny(missing_docs)]

//! Every typed Macro service URL, re-exported from its own crate in
//! `crates/platform/service_urls/`. New code depends on the one URL crate it
//! needs, so a URL change rebuilds only that URL's users; see that directory's
//! `AGENTS.md`.

pub use service_url::{
    ServiceUrl, ServiceUrlVarErr, Url, UrlParseError, read_override_env, service_url,
};
#[doc(hidden)]
pub use service_url::{macro_env, paste};

pub use agent_harness_egress_url::AgentHarnessEgressUrl;
pub use agent_harness_service_url::AgentHarnessServiceUrl;
pub use ai_editing_worker_url::AiEditingWorkerUrl;
pub use app_service_url::AppServiceUrl;
pub use auth_service_url::AuthServiceUrl;
pub use calendar_service_url::CalendarServiceUrl;
pub use cognition_public_url::CognitionPublicUrl;
pub use connect_api_url::ConnectApiUrl;
pub use connection_gateway_url::ConnectionGatewayUrl;
pub use connection_gateway_websocket_url::ConnectionGatewayWebsocketUrl;
pub use contacts_service_url::ContactsServiceUrl;
pub use convert_service_url::ConvertServiceUrl;
pub use document_cognition_service_url::DocumentCognitionServiceUrl;
pub use document_storage_service_url::DocumentStorageServiceUrl;
pub use email_service_url::EmailServiceUrl;
pub use image_proxy_service_url::ImageProxyServiceUrl;
pub use lexical_service_url::LexicalServiceUrl;
pub use mcp_public_url::McpPublicUrl;
pub use mcp_service_url::McpServiceUrl;
pub use notification_service_url::NotificationServiceUrl;
pub use preview_gateway_url::PreviewGatewayUrl;
pub use scheduled_action_service_url::ScheduledActionServiceUrl;
pub use search_processing_service_url::SearchProcessingServiceUrl;
pub use static_file_public_url::StaticFilePublicUrl;
pub use static_file_service_url::StaticFileServiceUrl;
pub use sync_service_url::SyncServiceUrl;
pub use unfurl_service_url::UnfurlServiceUrl;

#[cfg(test)]
mod test;

/// Common service URLs used by Macro services.
pub struct ServiceUrls {
    /// Main app URL.
    pub app_service_url: AppServiceUrl,
    /// Authentication service API URL.
    pub auth_service_url: AuthServiceUrl,
    /// Document storage service API URL.
    pub document_storage_service_url: DocumentStorageServiceUrl,
    /// Convert service API URL.
    pub convert_service_url: ConvertServiceUrl,
    /// Search processing service API URL.
    pub search_processing_service_url: SearchProcessingServiceUrl,
    /// Connection gateway HTTP API URL.
    pub connection_gateway_url: ConnectionGatewayUrl,
    /// Connection gateway WebSocket URL.
    pub connection_gateway_websocket_url: ConnectionGatewayWebsocketUrl,
    /// Document cognition service API URL.
    pub document_cognition_service_url: DocumentCognitionServiceUrl,
    /// Notification service API URL.
    pub notification_service_url: NotificationServiceUrl,
    /// Static file service/CDN URL.
    pub static_file_service_url: StaticFileServiceUrl,
    /// Browser-facing static file base that file links are stamped with.
    pub static_file_public_url: StaticFilePublicUrl,
    /// Agent harness service API URL. Serves the agent-session control
    pub agent_harness_service_url: AgentHarnessServiceUrl,
    /// Scheduled action service API URL.
    pub scheduled_action_service_url: ScheduledActionServiceUrl,
    /// Sandbox-facing agent harness egress proxy URL.
    pub agent_harness_egress_url: AgentHarnessEgressUrl,
    /// Macro MCP service base URL. Append `/mcp` for its transport endpoint.
    pub mcp_service_url: McpServiceUrl,
    /// Public MCP OAuth issuer and callback base, distinct from gateway transport routing.
    pub mcp_public_url: McpPublicUrl,
    /// Public integration callback base, preserving registered OAuth redirect URIs.
    pub cognition_public_url: CognitionPublicUrl,
    /// Macro Connect API base URL: Macro's OAuth broker for MCP connectors.
    pub connect_api_url: ConnectApiUrl,
    /// Link unfurl service API URL.
    pub unfurl_service_url: UnfurlServiceUrl,
    /// Contacts service API URL.
    pub contacts_service_url: ContactsServiceUrl,
    /// Email service API URL.
    pub email_service_url: EmailServiceUrl,
    /// Calendar service API URL. The calendar write authority once
    pub calendar_service_url: CalendarServiceUrl,
    /// Image proxy service API URL.
    pub image_proxy_service_url: ImageProxyServiceUrl,
    /// Lexical conversion service API URL.
    pub lexical_service_url: LexicalServiceUrl,
    /// Sync service API URL.
    pub sync_service_url: SyncServiceUrl,
    /// AI editing worker API URL.
    pub ai_editing_worker_url: AiEditingWorkerUrl,
}

impl ServiceUrls {
    /// Create a new instance of [`Self`] with all service URLs resolved for the current macro environment.
    pub fn new() -> Result<Self, ServiceUrlVarErr> {
        Self::new_for_environment(macro_env::Environment::new_or_prod())
    }

    /// Create a new instance of [`Self`] with all service URLs resolved for the current macro environment, panicking if an override env var is set but cannot be read.
    pub fn unwrap_new() -> Self {
        Self::new().expect("Failed to resolve service URL collection for ServiceUrls")
    }

    /// Create a new instance of [`Self`] with all service URLs resolved for a specific environment.
    pub fn new_for_environment(
        environment: macro_env::Environment,
    ) -> Result<Self, ServiceUrlVarErr> {
        Ok(Self {
            app_service_url: AppServiceUrl::new_for_environment(environment)?,
            auth_service_url: AuthServiceUrl::new_for_environment(environment)?,
            document_storage_service_url: DocumentStorageServiceUrl::new_for_environment(
                environment,
            )?,
            convert_service_url: ConvertServiceUrl::new_for_environment(environment)?,
            search_processing_service_url: SearchProcessingServiceUrl::new_for_environment(
                environment,
            )?,
            connection_gateway_url: ConnectionGatewayUrl::new_for_environment(environment)?,
            connection_gateway_websocket_url: ConnectionGatewayWebsocketUrl::new_for_environment(
                environment,
            )?,
            document_cognition_service_url: DocumentCognitionServiceUrl::new_for_environment(
                environment,
            )?,
            notification_service_url: NotificationServiceUrl::new_for_environment(environment)?,
            static_file_service_url: StaticFileServiceUrl::new_for_environment(environment)?,
            static_file_public_url: StaticFilePublicUrl::new_for_environment(environment)?,
            agent_harness_service_url: AgentHarnessServiceUrl::new_for_environment(environment)?,
            scheduled_action_service_url: ScheduledActionServiceUrl::new_for_environment(
                environment,
            )?,
            agent_harness_egress_url: AgentHarnessEgressUrl::new_for_environment(environment)?,
            mcp_service_url: McpServiceUrl::new_for_environment(environment)?,
            mcp_public_url: McpPublicUrl::new_for_environment(environment)?,
            cognition_public_url: CognitionPublicUrl::new_for_environment(environment)?,
            connect_api_url: ConnectApiUrl::new_for_environment(environment)?,
            unfurl_service_url: UnfurlServiceUrl::new_for_environment(environment)?,
            contacts_service_url: ContactsServiceUrl::new_for_environment(environment)?,
            email_service_url: EmailServiceUrl::new_for_environment(environment)?,
            calendar_service_url: CalendarServiceUrl::new_for_environment(environment)?,
            image_proxy_service_url: ImageProxyServiceUrl::new_for_environment(environment)?,
            lexical_service_url: LexicalServiceUrl::new_for_environment(environment)?,
            sync_service_url: SyncServiceUrl::new_for_environment(environment)?,
            ai_editing_worker_url: AiEditingWorkerUrl::new_for_environment(environment)?,
        })
    }

    /// Create a new instance of [`Self`] with all service URLs set to environment defaults without checking overrides.
    pub const fn default_for_environment(environment: macro_env::Environment) -> Self {
        Self {
            app_service_url: AppServiceUrl::default_for_environment(environment),
            auth_service_url: AuthServiceUrl::default_for_environment(environment),
            document_storage_service_url: DocumentStorageServiceUrl::default_for_environment(
                environment,
            ),
            convert_service_url: ConvertServiceUrl::default_for_environment(environment),
            search_processing_service_url: SearchProcessingServiceUrl::default_for_environment(
                environment,
            ),
            connection_gateway_url: ConnectionGatewayUrl::default_for_environment(environment),
            connection_gateway_websocket_url:
                ConnectionGatewayWebsocketUrl::default_for_environment(environment),
            document_cognition_service_url: DocumentCognitionServiceUrl::default_for_environment(
                environment,
            ),
            notification_service_url: NotificationServiceUrl::default_for_environment(environment),
            static_file_service_url: StaticFileServiceUrl::default_for_environment(environment),
            static_file_public_url: StaticFilePublicUrl::default_for_environment(environment),
            agent_harness_service_url: AgentHarnessServiceUrl::default_for_environment(environment),
            scheduled_action_service_url: ScheduledActionServiceUrl::default_for_environment(
                environment,
            ),
            agent_harness_egress_url: AgentHarnessEgressUrl::default_for_environment(environment),
            mcp_service_url: McpServiceUrl::default_for_environment(environment),
            mcp_public_url: McpPublicUrl::default_for_environment(environment),
            cognition_public_url: CognitionPublicUrl::default_for_environment(environment),
            connect_api_url: ConnectApiUrl::default_for_environment(environment),
            unfurl_service_url: UnfurlServiceUrl::default_for_environment(environment),
            contacts_service_url: ContactsServiceUrl::default_for_environment(environment),
            email_service_url: EmailServiceUrl::default_for_environment(environment),
            calendar_service_url: CalendarServiceUrl::default_for_environment(environment),
            image_proxy_service_url: ImageProxyServiceUrl::default_for_environment(environment),
            lexical_service_url: LexicalServiceUrl::default_for_environment(environment),
            sync_service_url: SyncServiceUrl::default_for_environment(environment),
            ai_editing_worker_url: AiEditingWorkerUrl::default_for_environment(environment),
        }
    }
}
