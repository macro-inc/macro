use std::future::ready;

use crate::api::search::{SearchPaginationParams, simple::SearchError};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use futures::future::Either;
use macro_user_id::user_id::MacroUserId;
use model::{response::ErrorResponse, user::UserContext};
use models_search::{
    SearchOn, SimpleSearchResponse,
    email::{EmailSearchRequest, SimpleEmailSearchResponse},
};
use opensearch_client::search::{
    emails::EmailSearchArgs,
    model::{Highlight, SearchHit},
};
use sqlx::types::Uuid;

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
) -> Result<Json<SimpleSearchResponse>, SearchError> {
    tracing::info!("simple_email_search");

    let results = search_emails(&ctx, user_context.user_id.as_str(), &query_params, req).await?;

    Ok(Json(SimpleSearchResponse {
        results: results.into_iter().map(|a| a.into()).collect(),
    }))
}

pub(in crate::api::search) async fn search_emails(
    ctx: &ApiContext,
    user_id: &str,
    query_params: &SearchPaginationParams,
    req: EmailSearchRequest,
) -> Result<Vec<opensearch_client::search::model::SearchHit>, SearchError> {
    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let user_id = MacroUserId::parse_from_str(user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?
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

    let terms: Vec<String> = if let Some(terms) = req.terms.as_ref() {
        terms
            .iter()
            .filter_map(|t| if t.len() < 3 { None } else { Some(t.clone()) })
            .collect()
    } else if let Some(query) = req.query.as_ref() {
        if query.len() < 3 {
            return Err(SearchError::InvalidQuerySize);
        }

        vec![query.clone()]
    } else {
        return Err(SearchError::NoQueryOrTermsProvided);
    };

    let filters = req.filters.unwrap_or_default();

    // For emails, thread_ids are not pre-filtered like documents/chats
    // Empty vec means search all accessible emails for the user
    let thread_uuids: Vec<Uuid> = vec![];

    let name_results = match req.search_on {
        SearchOn::Name | SearchOn::NameContent => Either::Left(name_search::search_email_subjects(
            &ctx.db,
            &user_id,
            &thread_uuids,
            terms[0].clone(),
            false, // ids_only is false since we're not pre-filtering
            page_size,
            page * page_size,
        )),
        SearchOn::Content => Either::Right(ready(Ok(Vec::new()))),
    };

    let content_results = match req.search_on {
        SearchOn::Content | SearchOn::NameContent => {
            Either::Left(ctx.opensearch_client.search_emails(EmailSearchArgs {
                terms: terms.clone(),
                user_id: user_id.as_ref().to_string(),
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
                ids_only: false,
                disable_recency: req.disable_recency,
            }))
        }
        SearchOn::Name => Either::Right(ready(Ok(Vec::new()))),
    };

    let (name_result, content_result) = tokio::join!(name_results, content_results);
    let name_result = name_result.map_err(SearchError::NameSearch)?;
    let content_result = content_result.map_err(SearchError::Search)?;

    let results: Vec<SearchHit> = name_result
        .into_iter()
        .map(|n| SearchHit {
            entity_id: n.entity_id,
            entity_type: n.entity_type,
            score: None,
            highlight: Highlight {
                name: Some(n.name),
                ..Default::default()
            },
            goto: None,
        })
        .chain(content_result)
        .collect();

    Ok(results)
}
