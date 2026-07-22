//! This module is responsible for enriching search results with metadata

use models_opensearch::SearchEntityType;
use models_search::unified::UnifiedSearchResponseItem;
use opensearch_client::search::model::SearchHit;

use crate::api::{
    context::SearchHandlerState,
    search::{
        call_record::enrich_call_records, channel::enrich_channel_messages, chat::enrich_chats,
        document::enrich_documents, email::enrich_emails, project::enrich_projects,
        simple::SearchError,
    },
};

/// Enriches search results with metadata and converts to UnifiedSearchResponseItem
#[tracing::instrument(skip(ctx, results), fields(result_count = results.len()), err)]
pub async fn enrich_search_response(
    ctx: &SearchHandlerState,
    user_id: &str,
    results: Vec<SearchHit>,
    entity_type: SearchEntityType,
    search_term: Option<&str>,
) -> Result<Vec<UnifiedSearchResponseItem>, SearchError> {
    match entity_type {
        SearchEntityType::Documents => {
            let response = enrich_documents(ctx, user_id, results, search_term).await?;
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
            let response = enrich_channel_messages(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::ChannelMessage)
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
        SearchEntityType::CallRecords => {
            let response = enrich_call_records(ctx, user_id, results).await?;
            Ok(response
                .into_iter()
                .map(UnifiedSearchResponseItem::Call)
                .collect())
        }
        // CRM companies are enriched separately (they need the team
        // receipt) via `crm_company::enrich_crm_companies`.
        SearchEntityType::CrmCompanies => Ok(vec![]),
    }
}
