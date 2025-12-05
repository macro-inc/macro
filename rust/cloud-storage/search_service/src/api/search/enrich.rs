//! This module is responsible for enriching search results with metadata

use models_opensearch::SearchEntityType;
use models_search::unified::UnifiedSearchResponseItem;
use opensearch_client::search::model::SearchHit;

use crate::api::{
    context::ApiContext,
    search::{
        channel::enrich_channels, chat::enrich_chats, document::enrich_documents,
        email::enrich_emails, project::enrich_projects, simple::SearchError,
    },
};

/// Enriches search results with metadat and converts to UnifiedSearchResponseItem
pub async fn enrich_search_response(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<SearchHit>,
    entity_type: SearchEntityType,
) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
    match entity_type {
        SearchEntityType::Documents => {
            let response = enrich_documents(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Document)
                .collect())
        }
        SearchEntityType::Emails => {
            let response = enrich_emails(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Email)
                .collect())
        }
        SearchEntityType::Channels => {
            let response = enrich_channels(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Channel)
                .collect())
        }
        SearchEntityType::Chats => {
            let response = enrich_chats(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Chat)
                .collect())
        }
        SearchEntityType::Projects => {
            let response = enrich_projects(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Project)
                .collect())
        }
    }
}
