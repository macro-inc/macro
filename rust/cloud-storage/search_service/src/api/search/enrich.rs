//! This module is responsible for enriching search results with metadata

use models_opensearch::OpenSearchEntityType;
use models_search::unified::UnifiedSearchResponseItem;
use opensearch_client::search::model::SearchHit;

use crate::api::{
    context::SearchHandlerState,
    search::{
        channel::enrich_channels, chat::enrich_chats, document::enrich_documents,
        email::enrich_emails, simple::SearchError,
    },
};

/// Enriches search results with metadat and converts to UnifiedSearchResponseItem
#[tracing::instrument(skip(ctx, results), fields(result_count = results.len()), err)]
pub async fn enrich_search_response(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<SearchHit>,
    entity_type: OpenSearchEntityType,
) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
    match entity_type {
        OpenSearchEntityType::Documents => {
            let response = enrich_documents(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Document)
                .collect())
        }
        OpenSearchEntityType::Emails => {
            let response = enrich_emails(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Email)
                .collect())
        }
        OpenSearchEntityType::Channels => {
            let response = enrich_channels(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Channel)
                .collect())
        }
        OpenSearchEntityType::Chats => {
            let response = enrich_chats(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Chat)
                .collect())
        }
    }
}
