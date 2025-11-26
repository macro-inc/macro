use crate::api::ApiContext;
use crate::api::search::simple::SearchError;
use crate::api::search::simple::simple_email::search_emails;
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_email::service::message::{ThreadHistoryInfo, ThreadHistoryRequest};
use models_search::email::{
    EmailSearchRequest, EmailSearchResponse, EmailSearchResponseItem,
    EmailSearchResponseItemWithMetadata, EmailSearchResult,
};
use opensearch_client::search::model::SearchGotoContent;
use sqlx::types::Uuid;
use std::collections::HashMap;

use super::SearchPaginationParams;

/// Enriches email search results with metadata
#[tracing::instrument(skip(ctx, results), err)]
pub(in crate::api::search) async fn enrich_emails(
    ctx: &ApiContext,
    user_id: &str,
    results: Vec<opensearch_client::search::model::SearchHit>,
) -> Result<Vec<EmailSearchResponseItemWithMetadata>, SearchError> {
    let results: Vec<opensearch_client::search::model::SearchHit> = results
        .into_iter()
        .filter(|r| r.entity_type == models_opensearch::SearchEntityType::Emails)
        .collect();

    if results.is_empty() {
        return Ok(vec![]);
    }

    // Extract thread IDs from results
    let thread_ids: Vec<Uuid> = results
        .iter()
        .filter_map(|r| {
            match Uuid::parse_str(&r.entity_id) {
                Ok(uuid) => Some(uuid),
                Err(e) => {
                    tracing::warn!(error=?e, thread_id=?r.entity_id, "Failed to parse thread ID as UUID");
                    None
                }
            }
        })
        .collect();

    // Fetch email thread metadata from email service
    let thread_histories = ctx
        .email_service_client
        .get_thread_histories(ThreadHistoryRequest {
            user_id: user_id.to_string(),
            thread_ids,
        })
        .await
        .map_err(SearchError::InternalError)?;

    // Construct enriched results
    let enriched_results = construct_search_result(results, thread_histories.history_map)
        .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
}

/// Performs a search through emails and enriches the results with metadata
#[tracing::instrument(skip(ctx, query_params, req), err)]
pub async fn search_emails_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: EmailSearchRequest,
) -> Result<Vec<EmailSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_emails(ctx, user_id, query_params, req).await?;

    enrich_emails(ctx, user_id, opensearch_results).await
}

/// Perform a search through your emails
#[utoipa::path(
        post,
        path = "/search/email",
        operation_id = "email_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=EmailSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    user_context: Extension<UserContext>,
    State(ctx): State<ApiContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<EmailSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("email_search");
    let user_id = user_context.user_id.as_str();

    let results = search_emails_enriched(&ctx, user_id, &query_params, req).await?;

    let result = EmailSearchResponse { results };

    Ok((StatusCode::OK, Json(result)).into_response())
}

pub fn construct_search_result(
    search_results: Vec<opensearch_client::search::model::SearchHit>,
    thread_histories: HashMap<Uuid, ThreadHistoryInfo>,
) -> anyhow::Result<Vec<EmailSearchResponseItemWithMetadata>> {
    // construct entity hit map of id -> vec<hits>
    let entity_id_hit_map: HashMap<Uuid, Vec<EmailSearchResult>> = search_results
        .into_iter()
        .map(|hit| {
            let result = if let Some(SearchGotoContent::Emails(goto)) = hit.goto {
                EmailSearchResult {
                    message_id: Some(goto.email_message_id),
                    bcc: goto.bcc,
                    cc: goto.cc,
                    labels: goto.labels,
                    sent_at: goto.sent_at,
                    sender: Some(goto.sender),
                    recipients: goto.recipients,
                    highlight: hit.highlight.into(),
                    score: hit.score,
                }
            } else {
                // name match
                EmailSearchResult {
                    message_id: None,
                    bcc: vec![],
                    cc: vec![],
                    labels: vec![],
                    sent_at: None,
                    sender: None,
                    recipients: vec![],
                    highlight: hit.highlight.into(),
                    score: hit.score,
                }
            };
            (hit.entity_id.parse().unwrap(), result)
        })
        .fold(HashMap::new(), |mut map, (entity_id, result)| {
            map.entry(entity_id).or_insert_with(Vec::new).push(result);
            map
        });

    // now construct the search results
    let result: Vec<EmailSearchResponseItemWithMetadata> = entity_id_hit_map
        .into_iter()
        .filter_map(|(entity_id, hits)| {
            if let Some(info) = thread_histories.get(&entity_id) {
                let info = info.clone();
                Some(EmailSearchResponseItemWithMetadata {
                    created_at: info.created_at.timestamp(),
                    updated_at: info.updated_at.timestamp(),
                    viewed_at: info.viewed_at.map(|a| a.timestamp()),
                    snippet: info.snippet,
                    extra: EmailSearchResponseItem {
                        id: entity_id.to_string(),
                        thread_id: entity_id.to_string(),
                        owner_id: info.user_id.clone(),
                        user_id: info.user_id,
                        name: info.subject.clone(),
                        subject: info.subject,
                        email_message_search_results: hits,
                    },
                })
            } else {
                None
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
