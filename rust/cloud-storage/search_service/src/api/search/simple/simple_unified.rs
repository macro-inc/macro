use crate::api::{
    ApiContext,
    search::{
        SearchPaginationParams,
        simple::{
            SearchError,
            simple_channel::{FilterChannelResponse, filter_channels},
            simple_chat::{FilterChatResponse, filter_chats},
            simple_document::{FilterDocumentResponse, filter_documents},
            simple_project::{FilterProjectResponse, filter_projects},
        },
    },
};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::{SimpleUnifiedSearchResponse, UnifiedSearchRequest};
use opensearch_client::search::unified::{
    UnifiedChannelMessageSearchArgs, UnifiedChatSearchArgs, UnifiedDocumentSearchArgs,
    UnifiedEmailSearchArgs, UnifiedProjectSearchArgs, UnifiedSearchArgs,
};

pub(in crate::api::search) enum UnifiedFilterVariant {
    Document(FilterDocumentResponse),
    Channel(FilterChannelResponse),
    Chat(FilterChatResponse),
    Project(FilterProjectResponse),
}

/// Creates a unified search request and performs the search
/// Returning the opensearch results
#[tracing::instrument(skip(ctx, user_context, query_params, req), err)]
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &ApiContext,
    user_context: &UserContext,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<Vec<opensearch_client::search::unified::UnifiedSearchResponse>, SearchError> {
    let user_id = &user_context.user_id;
    let user_organization_id = user_context.organization_id;
    let search_on = req.search_on;
    let collapse = req.collapse.unwrap_or(false);

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }

    let page = query_params.page.unwrap_or(0);

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let terms: Vec<String> = match (req.terms, req.query) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    let filters = req.filters.unwrap_or_default();
    let match_type = req.match_type;
    let disable_recency = req.disable_recency;

    let channel_filters = filters.channel.unwrap_or_default();
    let email_filters = filters.email.unwrap_or_default();
    let chat_filters = filters.chat.unwrap_or_default();
    let project_filters = filters.project.unwrap_or_default();

    // Parallelize filter calls using tokio tasks
    let ctx_doc = ctx.clone();
    let user_id_doc = user_id.to_string();
    let doc_filters = filters.document.unwrap_or_default();
    let doc_task = tokio::spawn(async move {
        filter_documents(&ctx_doc, &user_id_doc, &doc_filters)
            .await
            .map(UnifiedFilterVariant::Document)
    });

    let ctx_channel = ctx.clone();
    let user_id_channel = user_id.to_string();
    let channel_filters_clone = channel_filters.clone();
    let channel_task = tokio::spawn(async move {
        filter_channels(
            &ctx_channel,
            &user_id_channel,
            user_organization_id,
            &channel_filters_clone,
        )
        .await
        .map(UnifiedFilterVariant::Channel)
    });

    let ctx_chat = ctx.clone();
    let user_id_chat = user_id.to_string();
    let chat_filters_clone = chat_filters.clone();
    let chat_task = tokio::spawn(async move {
        filter_chats(&ctx_chat, &user_id_chat, &chat_filters_clone)
            .await
            .map(UnifiedFilterVariant::Chat)
    });

    let ctx_project = ctx.clone();
    let user_id_project = user_id.to_string();
    let project_filters_clone = project_filters.clone();
    let project_task = tokio::spawn(async move {
        filter_projects(&ctx_project, &user_id_project, &project_filters_clone)
            .await
            .map(UnifiedFilterVariant::Project)
    });

    // Await all tasks in parallel
    let (doc_result, channel_result, chat_result, project_result) =
        tokio::try_join!(doc_task, channel_task, chat_task, project_task)
            .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    // Extract results from FilterVariant enum
    let filter_document_response = match doc_result? {
        UnifiedFilterVariant::Document(response) => response,
        _ => unreachable!(),
    };

    let filter_channel_response = match channel_result? {
        UnifiedFilterVariant::Channel(response) => response,
        _ => unreachable!(),
    };

    let filter_chat_response = match chat_result? {
        UnifiedFilterVariant::Chat(response) => response,
        _ => unreachable!(),
    };

    let filter_project_response = match project_result? {
        UnifiedFilterVariant::Project(response) => response,
        _ => unreachable!(),
    };

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
            thread_ids: vec![],
            link_ids: vec![],
            sender: email_filters.senders,
            cc: email_filters.cc,
            bcc: email_filters.bcc,
            recipients: email_filters.recipients,
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: filter_channel_response
                .channel_ids
                .iter()
                .map(|c| c.to_string())
                .collect(),
            thread_ids: channel_filters.thread_ids,
            mentions: channel_filters.mentions,
            sender_ids: channel_filters.sender_ids,
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: filter_chat_response.chat_ids,
            role: chat_filters.role,
            ids_only: filter_chat_response.ids_only,
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: filter_project_response.project_ids,
            ids_only: filter_project_response.ids_only,
        },
    };

    let results = ctx
        .opensearch_client
        .search_unified(unified_search_args)
        .await?;

    Ok(results)
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
) -> Result<Json<SimpleUnifiedSearchResponse>, SearchError> {
    tracing::info!("simple_unified_search");

    let results = perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    Ok(Json(SimpleUnifiedSearchResponse { results }))
}
