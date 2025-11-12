use crate::api::search::simple::SearchError;
use crate::{api::ApiContext, util};
use crate::{api::search::simple::simple_email::search_emails, model::EmailOpenSearchResponse};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_email::service::message::{ThreadHistoryInfo, ThreadHistoryRequest};
use models_search::email::{
    EmailSearchMetadata, EmailSearchRequest, EmailSearchResponse, EmailSearchResponseItem,
    EmailSearchResponseItemWithMetadata, EmailSearchResult,
};
use sqlx::types::Uuid;
use std::collections::HashMap;

use super::SearchPaginationParams;

/// Performs a search through emails and enriches the results with metadata
pub async fn search_emails_enriched(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: EmailSearchRequest,
) -> Result<Vec<EmailSearchResponseItemWithMetadata>, SearchError> {
    // Use the simple search to get raw OpenSearch results
    let opensearch_results = search_emails(ctx, user_id, query_params, req).await?;

    // Extract thread IDs from results
    let thread_ids: Vec<Uuid> = opensearch_results
        .iter()
        .filter_map(|r| {
            match Uuid::parse_str(&r.thread_id) {
                Ok(uuid) => Some(uuid),
                Err(e) => {
                    tracing::warn!(error=?e, thread_id=?r.thread_id, "Failed to parse thread ID as UUID");
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
    let enriched_results =
        construct_search_result(opensearch_results, thread_histories.history_map)
            .map_err(SearchError::InternalError)?;

    Ok(enriched_results)
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
    search_results: Vec<opensearch_client::search::emails::EmailSearchResponse>,
    thread_histories: HashMap<Uuid, ThreadHistoryInfo>,
) -> anyhow::Result<Vec<EmailSearchResponseItemWithMetadata>> {
    let search_results = search_results
        .into_iter()
        .map(|inner| EmailOpenSearchResponse { inner })
        .collect();
    let result = util::construct_search_result::<
        EmailOpenSearchResponse,
        EmailSearchResult,
        EmailSearchMetadata,
    >(search_results)?;
    // To preserve backwards compatibility for now, convert back into old struct
    let result: Vec<EmailSearchResponseItem> = result.into_iter().map(|a| a.into()).collect();

    let result: Vec<EmailSearchResponseItemWithMetadata> = result
        .into_iter()
        .map(|item| {
            let message_uuid = Uuid::parse_str(&item.thread_id).unwrap_or_else(|_| Uuid::nil());
            let message_history_info = thread_histories
                .get(&message_uuid)
                .cloned()
                .unwrap_or_default();
            EmailSearchResponseItemWithMetadata {
                created_at: message_history_info.created_at.timestamp(),
                updated_at: message_history_info.updated_at.timestamp(),
                viewed_at: message_history_info.viewed_at.map(|a| a.timestamp()),
                extra: item,
            }
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod test;
