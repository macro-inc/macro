use crate::api::search::{SearchPaginationParams, simple::SearchError};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::email::{EmailSearchRequest, SimpleEmailSearchResponse};
use opensearch_client::search::emails::EmailSearchArgs;

use crate::api::ApiContext;

/// Perform a search through your emails
/// This is a simple search where we do not group your results by thread id.
#[utoipa::path(
        post,
        path = "/search/simple/email",
        operation_id = "simple_email_search",
        params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
        ),
        responses(
            (status = 200, body=SimpleEmailSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<EmailSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("simple_email_search");

    let results = search_emails(&ctx, user_context.user_id.as_str(), &query_params, req).await?;

    Ok((
        StatusCode::OK,
        Json(SimpleEmailSearchResponse {
            results: results.into_iter().map(|a| a.into()).collect(),
        }),
    )
        .into_response())
}

pub(in crate::api::search) async fn search_emails(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: EmailSearchRequest,
) -> Result<Vec<opensearch_client::search::emails::EmailSearchResponse>, SearchError> {
    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let page = query_params.page.unwrap_or(0);

    let page_size = if let Some(page_size) = query_params.page_size {
        if !(0..=100).contains(&page_size) {
            return Err(SearchError::InvalidPageSize);
        }
        page_size
    } else {
        10
    };

    let terms: Vec<String> = if let Some(terms) = req.terms {
        terms
            .into_iter()
            .filter_map(|t| if t.len() < 3 { None } else { Some(t) })
            .collect()
    } else if let Some(query) = req.query {
        if query.len() < 3 {
            return Err(SearchError::InvalidQuerySize);
        }

        vec![query]
    } else {
        return Err(SearchError::NoQueryOrTermsProvided);
    };

    let filters = req.filters.unwrap_or_default();

    let results = ctx
        .opensearch_client
        .search_emails(EmailSearchArgs {
            terms,
            user_id: user_id.to_string(),
            message_ids: vec![],
            thread_ids: vec![],
            link_ids: vec![],
            sender: filters.senders,
            cc: filters.cc,
            bcc: filters.bcc,
            recipients: filters.recipients,
            page,
            page_size,
            match_type: req.match_type.to_string(),
            search_on: req.search_on.into(),
            collapse: req.collapse.unwrap_or(false),
            ids_only: false, // TODO: implement
        })
        .await
        .map_err(SearchError::Search)?;

    Ok(results)
}
