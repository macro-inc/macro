use crate::api::search::{SearchPaginationParams, simple::SearchError};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use item_filters::EmailFilters;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
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

    let user_id = MacroUserId::parse_from_str(user_id)
        .map_err(|_| SearchError::InvalidMacroUserId)?
        .lowercase();

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

    let ids_only = !(filters.senders.is_empty()
        || filters.cc.is_empty()
        || filters.bcc.is_empty()
        || filters.recipients.is_empty());

    // Filter thread ids if filters are provided
    let thread_ids = if ids_only {
        filter_thread_ids(&ctx.db, &user_id, filters)
            .await
            .map_err(SearchError::InternalError)?
    } else {
        vec![]
    };

    // If we have no thread_ids and ids_only is true, return an empty vec
    if ids_only && thread_ids.is_empty() {
        return Ok(vec![]);
    }

    let results = ctx
        .opensearch_client
        .search_emails(EmailSearchArgs {
            terms,
            user_id: user_id.as_ref().to_string(),
            thread_ids: thread_ids.iter().map(|t| t.to_string()).collect(),
            page,
            page_size,
            match_type: req.match_type.to_string(),
            search_on: req.search_on.into(),
            collapse: req.collapse.unwrap_or(false),
            ids_only,
        })
        .await
        .map_err(SearchError::Search)?;

    Ok(results)
}

/// Creates a filtered list of thread ids for the provided user
#[tracing::instrument(skip(db), err)]
async fn filter_thread_ids(
    db: &sqlx::PgPool,
    user_id: &MacroUserId<Lowercase<'_>>,
    filters: EmailFilters,
) -> anyhow::Result<Vec<sqlx::types::Uuid>> {
    // Get the base thread ids for the user
    let thread_ids = macro_db_client::items::filter::get_thread_ids_for_user(db, user_id).await?;

    // Filter thread ids by senders
    let thread_ids = if !filters.senders.is_empty() {
        macro_db_client::items::filter::filter_thread_ids_by_senders(
            db,
            &thread_ids,
            &filters.senders,
        )
        .await?
    } else {
        thread_ids
    };

    if thread_ids.is_empty() {
        return Ok(vec![]);
    }

    // Filter thread ids by senders and recipients
    let thread_ids = if !filters.recipients.is_empty() {
        macro_db_client::items::filter::filter_thread_ids_by_recipients(
            db,
            &thread_ids,
            &filters.recipients,
        )
        .await?
    } else {
        thread_ids
    };

    if thread_ids.is_empty() {
        return Ok(vec![]);
    }

    // Filter thread ids by cc
    let thread_ids = if !filters.cc.is_empty() {
        macro_db_client::items::filter::filter_thread_ids_by_cc(db, &thread_ids, &filters.cc)
            .await?
    } else {
        thread_ids
    };

    if thread_ids.is_empty() {
        return Ok(vec![]);
    }

    // Filter thread ids by bcc
    if !filters.bcc.is_empty() {
        macro_db_client::items::filter::filter_thread_ids_by_bcc(db, &thread_ids, &filters.bcc)
            .await
    } else {
        Ok(thread_ids)
    }
}
