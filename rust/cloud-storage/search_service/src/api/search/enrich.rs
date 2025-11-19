//! This module is responsible for enriching search results with metadata

use models_search::unified::UnifiedSearchResponseItem;
use opensearch_client::search::{
    channels::ChannelMessageSearchResponse, chats::ChatSearchResponse,
    documents::DocumentSearchResponse, emails::EmailSearchResponse,
    projects::ProjectSearchResponse,
};

use crate::api::{
    context::ApiContext,
    search::{
        channel::enrich_channels, chat::enrich_chats, document::enrich_documents,
        email::enrich_emails, project::enrich_projects, simple::SearchError,
    },
};

/// Trait to enrich the search results from opensearch with extra data
pub(super) trait EnrichSearchResponse<T>: Iterator<Item = T> {
    fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<UnifiedSearchResponseItem>, SearchError>> + Send;
}

impl<T> EnrichSearchResponse<DocumentSearchResponse> for T
where
    T: Iterator<Item = DocumentSearchResponse> + Send,
{
    async fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
        let response = enrich_documents(ctx, user_id, self.collect()).await?;
        Ok(response
            .into_iter()
            .map(UnifiedSearchResponseItem::Document)
            .collect())
    }
}

impl<T> EnrichSearchResponse<EmailSearchResponse> for T
where
    T: Iterator<Item = EmailSearchResponse> + Send,
{
    async fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
        let response = enrich_emails(ctx, user_id, self.collect()).await?;
        Ok(response
            .into_iter()
            .map(UnifiedSearchResponseItem::Email)
            .collect())
    }
}

impl<T> EnrichSearchResponse<ChannelMessageSearchResponse> for T
where
    T: Iterator<Item = ChannelMessageSearchResponse> + Send,
{
    async fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
        let response = enrich_channels(ctx, user_id, self.collect()).await?;
        Ok(response
            .into_iter()
            .map(UnifiedSearchResponseItem::Channel)
            .collect())
    }
}

impl<T> EnrichSearchResponse<ChatSearchResponse> for T
where
    T: Iterator<Item = ChatSearchResponse> + Send,
{
    async fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
        let response = enrich_chats(ctx, user_id, self.collect()).await?;
        Ok(response
            .into_iter()
            .map(UnifiedSearchResponseItem::Chat)
            .collect())
    }
}

impl<T> EnrichSearchResponse<ProjectSearchResponse> for T
where
    T: Iterator<Item = ProjectSearchResponse> + Send,
{
    async fn enrich_search_response(
        self,
        ctx: &ApiContext,
        user_id: &str,
    ) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
        let response = enrich_projects(ctx, user_id, self.collect()).await?;
        Ok(response
            .into_iter()
            .map(UnifiedSearchResponseItem::Project)
            .collect())
    }
}
