use crate::api::{
    ApiContext,
    search::{
        SearchPaginationParams,
        simple::{SearchError, simple_document::filter_documents},
    },
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use futures::FutureExt;
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::{SimpleUnifiedSearchResponse, UnifiedSearchRequest};
use opensearch_client::search::unified::{
    UnifiedChannelMessageSearchArgs, UnifiedChatSearchArgs, UnifiedDocumentSearchArgs,
    UnifiedEmailSearchArgs, UnifiedProjectSearchArgs, UnifiedSearchArgs,
};

/// This utility function provides a unified approach for processing search futures across different content types
/// (documents, chats, emails, etc.). It handles the complete flow from raw search execution through metadata
/// enrichment to final result formatting.
///
/// # Type Parameters
/// - `Fut`: Future that executes the OpenSearch query and fetches associated metadata, yielding `(T, U)`
/// - `T`: Raw search results returned from the OpenSearch operation
/// - `U`: Metadata retrieved from external sources to enrich the search results
/// - `S`: Intermediate search result type after combining raw results with metadata
/// - `V`: Structured search result type for the unified response format
///
/// # Parameters
/// - `search_future`: Async operation performing the search and metadata retrieval
/// - `variant_mapper`: Converts structured results into the unified response format
///
/// # Returns
/// A boxed future resolving to either unified search response items or a SearchError
pub(crate) fn boxed_search_future<Fut, T, S, V>(
    search_future: Fut,
    variant_mapper: fn(S) -> V,
) -> futures::future::BoxFuture<'static, Result<Vec<V>, SearchError>>
where
    Fut: futures::Future<Output = Result<Vec<T>, SearchError>> + Send + 'static,
    T: 'static + std::convert::Into<S>,
    S: 'static,
    V: 'static,
{
    search_future
        .map(move |res| {
            res.map(|items| {
                items
                    .into_iter()
                    .map(|item| variant_mapper(item.into()))
                    .collect::<Vec<V>>()
            })
        })
        .boxed()
}

/// Perform a search through all items.
/// This is a simple search where we do not group your results by entity id.
#[utoipa::path(
    post,
    path = "/search/simple",
    operation_id = "simple_unified_search",
    params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
    ),
    responses(
            (status = 200, body=SimpleUnifiedSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<UnifiedSearchRequest>,
) -> Result<Response, SearchError> {
    tracing::info!("simple_unified_search");

    let user_id = &user_context.user_id;
    let user_organization_id = user_context.organization_id;
    let search_on = req.search_on;
    let collapse = req.collapse.unwrap_or(false);

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    // TODO: deduplicate logic for getting page and page size

    let page = query_params.page.unwrap_or(0);

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    // TODO: deduplicate logic for extracting terms
    let terms: Vec<String> = match (req.terms, req.query) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    // no filters means search all
    let filters = req.filters.unwrap_or_default();
    let match_type = req.match_type;
    let disable_recency = req.disable_recency;

    let filter_document_response =
        filter_documents(&ctx, user_id, &filters.document.unwrap_or_default()).await?;

    let unified_search_args = UnifiedSearchArgs {
        terms,
        user_id: user_id.to_string(),
        page,
        page_size,
        match_type: match_type.to_string(),
        search_on: search_on.into(),
        collapse,
        disable_recency,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: filter_document_response.document_ids,
            ids_only: filter_document_response.ids_only,
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: Vec::new(),
            link_ids: Vec::new(),
            sender: Vec::new(),
            cc: Vec::new(),
            bcc: Vec::new(),
            recipients: Vec::new(),
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: Vec::new(),
            thread_ids: Vec::new(),
            mentions: Vec::new(),
            sender_ids: Vec::new(),
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: Vec::new(),
            role: Vec::new(),
            ids_only: false,
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: Vec::new(),
            ids_only: false,
        },
    };

    let results = ctx
        .opensearch_client
        .search_unified(unified_search_args)
        .await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    Ok((
        StatusCode::OK,
        Json(SimpleUnifiedSearchResponse { results }),
    )
        .into_response())
}

// /// Perform a search through all items.
// /// This is a simple search where we do not group your results by entity id.
// #[utoipa::path(
//     post,
//     path = "/search/simple",
//     operation_id = "simple_unified_search",
//     params(
//             ("page" = i64, Query, description = "The page. Defaults to 0."),
//             ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
//     ),
//     responses(
//             (status = 200, body=SimpleUnifiedSearchResponse),
//             (status = 400, body=ErrorResponse),
//             (status = 401, body=ErrorResponse),
//             (status = 500, body=ErrorResponse),
//     )
// )]
// #[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id), err)]
// pub async fn handler(
//     State(ctx): State<ApiContext>,
//     user_context: Extension<UserContext>,
//     extract::Query(query_params): extract::Query<SearchPaginationParams>,
//     extract::Json(req): extract::Json<UnifiedSearchRequest>,
// ) -> Result<Response, SearchError> {
//     tracing::info!("simple_unified_search");
//
//     let user_id = &user_context.user_id;
//     let user_organization_id = user_context.organization_id;
//     let search_on = req.search_on;
//     let collapse = req.collapse.unwrap_or(false);
//
//     if user_id.is_empty() {
//         return Err(SearchError::NoUserId);
//     }
//
//     // TODO: deduplicate logic for getting page and page size
//
//     let page = query_params.page.unwrap_or(0);
//
//     let page_size = query_params.page_size.unwrap_or(10);
//     if !(0..=100).contains(&page_size) {
//         return Err(SearchError::InvalidPageSize);
//     }
//
//     // TODO: deduplicate logic for extracting terms
//     let terms: Vec<String> = match (req.terms, req.query) {
//         (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
//         (None, Some(query)) if query.len() >= 3 => vec![query],
//         (None, Some(_)) => {
//             return Err(SearchError::InvalidQuerySize);
//         }
//         _ => vec![],
//     };
//
//     // no filters means search all
//     let filters = req.filters.unwrap_or_default();
//     let match_type = req.match_type;
//     let disable_recency = req.disable_recency;
//
//     let include_all_items = req.include.is_empty();
//
//     let mut tasks = FuturesUnordered::new();
//
//     if include_all_items || req.include.contains(&UnifiedSearchIndex::Documents) {
//         let query_params = SearchPaginationParams {
//             page: Some(page),
//             page_size: Some(page_size),
//         };
//
//         let request = DocumentSearchRequest {
//             query: None,
//             terms: Some(terms.clone()),
//             match_type,
//             filters: filters.document,
//             search_on,
//             collapse: Some(collapse),
//             disable_recency,
//         };
//
//         let ctx = ctx.clone();
//         let user_id = user_id.clone();
//
//         tasks.push(boxed_search_future(
//             async move {
//                 simple_document::search_documents(&ctx, &user_id, &query_params, request).await
//             },
//             SimpleUnifiedSearchResponseItem::Document,
//         ));
//     }
//
//     if include_all_items || req.include.contains(&UnifiedSearchIndex::Chats) {
//         let query_params = SearchPaginationParams {
//             page: Some(page),
//             page_size: Some(page_size),
//         };
//
//         let request = ChatSearchRequest {
//             query: None,
//             terms: Some(terms.clone()),
//             match_type,
//             filters: filters.chat,
//             search_on,
//             collapse: Some(collapse),
//             disable_recency,
//         };
//
//         let ctx = ctx.clone();
//         let user_id = user_id.clone();
//
//         tasks.push(boxed_search_future(
//             async move { simple_chat::search_chats(&ctx, &user_id, &query_params, request).await },
//             SimpleUnifiedSearchResponseItem::Chat,
//         ));
//     }
//
//     if include_all_items || req.include.contains(&UnifiedSearchIndex::Emails) {
//         let query_params = SearchPaginationParams {
//             page: Some(page),
//             page_size: Some(page_size),
//         };
//
//         let request = EmailSearchRequest {
//             query: None,
//             terms: Some(terms.clone()),
//             match_type,
//             filters: filters.email,
//             search_on,
//             collapse: Some(collapse),
//             disable_recency,
//         };
//
//         let ctx = ctx.clone();
//         let user_id = user_id.clone();
//
//         tasks.push(
//             boxed_search_future(
//                 async move {
//                     simple_email::search_emails(&ctx, &user_id, &query_params, request).await
//                 },
//                 SimpleUnifiedSearchResponseItem::Email,
//             ),
//         );
//     }
//
//     if include_all_items || req.include.contains(&UnifiedSearchIndex::Channels) {
//         let query_params = SearchPaginationParams {
//             page: Some(page),
//             page_size: Some(page_size),
//         };
//
//         let request = ChannelSearchRequest {
//             query: None,
//             terms: Some(terms.clone()),
//             match_type,
//             filters: filters.channel,
//             search_on,
//             collapse: Some(collapse),
//             disable_recency,
//         };
//
//         let ctx = ctx.clone();
//         let user_id = user_id.clone();
//
//         tasks.push(boxed_search_future(
//             async move {
//                 simple_channel::search_channels(
//                     &ctx,
//                     &user_id,
//                     user_organization_id,
//                     &query_params,
//                     request,
//                 )
//                 .await
//             },
//             SimpleUnifiedSearchResponseItem::Channel,
//         ));
//     }
//
//     if include_all_items || req.include.contains(&UnifiedSearchIndex::Projects) {
//         let query_params = SearchPaginationParams {
//             page: Some(page),
//             page_size: Some(page_size),
//         };
//
//         let request = ProjectSearchRequest {
//             query: None,
//             terms: Some(terms),
//             match_type,
//             filters: filters.project,
//             search_on,
//             collapse: Some(collapse),
//             disable_recency,
//         };
//
//         let ctx = ctx.clone();
//         let user_id = user_id.clone();
//
//         tasks.push(
//             boxed_search_future(
//                 async move {
//                     simple_project::search_projects(&ctx, &user_id, &query_params, request).await
//                 },
//                 SimpleUnifiedSearchResponseItem::Project,
//             ),
//         );
//     }
//
//     let mut results = Vec::new();
//
//     while let Some(result) = tasks.next().await {
//         match result {
//             Ok(items) => results.extend(items),
//             Err(err_response) => return Err(err_response),
//         }
//     }
//
//     Ok((
//         StatusCode::OK,
//         Json(SimpleUnifiedSearchResponse { results }),
//     )
//         .into_response())
// }
