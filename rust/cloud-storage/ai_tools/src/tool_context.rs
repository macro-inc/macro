use scribe::{
    ScribeClient, channel::ChannelClient, dcs::DcsClient, document::DocumentClient,
    email::EmailClient, static_file::StaticFileClient,
};
use std::sync::Arc;

pub type ToolScribe =
    ScribeClient<DocumentClient, ChannelClient, DcsClient, EmailClient, StaticFileClient>;

#[derive(Clone)]
pub struct ToolServiceContext {
    pub search_service_client: Arc<search_service_client::SearchServiceClient>,
    pub email_service_client: Arc<email_service_client::EmailServiceClientExternal>,
    pub scribe: Arc<ToolScribe>,
}

#[derive(Debug, Clone)]
pub struct RequestContext {
    pub user_id: String,
    pub jwt_token: String,
}
