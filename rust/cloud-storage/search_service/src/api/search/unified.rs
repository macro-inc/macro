use super::SearchPaginationParams;
use crate::api::{
    ApiContext,
    search::{
        channel::enrich_channels,
        chat::enrich_chats,
        document::enrich_documents,
        email::enrich_emails,
        project::enrich_projects,
        simple::{SearchError, simple_unified::perform_unified_search},
    },
};
use axum::{
    Extension,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::{
    UnifiedSearchRequest, UnifiedSearchResponse, UnifiedSearchResponseItem,
};

/// Perform a search through all items
#[utoipa::path(
    post,
    path = "/search",
    operation_id = "unified_search",
    params(
            ("page" = i64, Query, description = "The page. Defaults to 0."),
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
    ),
    responses(
            (status = 200, body=UnifiedSearchResponse),
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
    tracing::info!("unified_search");

    let results = perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let document_results: Vec<opensearch_client::search::documents::DocumentSearchResponse> =
        results
            .iter()
            .filter_map(|r| match r {
                opensearch_client::search::unified::UnifiedSearchResponse::Document(a) => {
                    Some(a.clone())
                }
                _ => None,
            })
            .collect();

    let channel_results: Vec<opensearch_client::search::channels::ChannelMessageSearchResponse> =
        results
            .iter()
            .filter_map(|r| match r {
                opensearch_client::search::unified::UnifiedSearchResponse::ChannelMessage(a) => {
                    Some(a.clone())
                }
                _ => None,
            })
            .collect();

    let chat_results: Vec<opensearch_client::search::chats::ChatSearchResponse> = results
        .iter()
        .filter_map(|r| match r {
            opensearch_client::search::unified::UnifiedSearchResponse::Chat(a) => Some(a.clone()),
            _ => None,
        })
        .collect();

    let project_results: Vec<opensearch_client::search::projects::ProjectSearchResponse> = results
        .iter()
        .filter_map(|r| match r {
            opensearch_client::search::unified::UnifiedSearchResponse::Project(a) => {
                Some(a.clone())
            }
            _ => None,
        })
        .collect();

    let email_results: Vec<opensearch_client::search::emails::EmailSearchResponse> = results
        .iter()
        .filter_map(|r| match r {
            opensearch_client::search::unified::UnifiedSearchResponse::Email(a) => Some(a.clone()),
            _ => None,
        })
        .collect();

    let ctx_clone = ctx.clone();
    let user_id_clone = user_context.user_id.clone();
    let document_results_clone = document_results.clone();
    let enriched_documents = tokio::spawn(async move {
        enrich_documents(&ctx_clone, &user_id_clone, document_results_clone)
            .await
            .map(|v| {
                v.into_iter()
                    .map(UnifiedSearchResponseItem::Document)
                    .collect::<Vec<UnifiedSearchResponseItem>>()
            })
    });

    let ctx_clone = ctx.clone();
    let user_id_clone = user_context.user_id.clone();
    let chat_results_clone = chat_results.clone();
    let enriched_chats = tokio::spawn(async move {
        enrich_chats(&ctx_clone, &user_id_clone, chat_results_clone)
            .await
            .map(|v| {
                v.into_iter()
                    .map(UnifiedSearchResponseItem::Chat)
                    .collect::<Vec<UnifiedSearchResponseItem>>()
            })
    });

    let ctx_clone = ctx.clone();
    let user_id_clone = user_context.user_id.clone();
    let channel_results_clone = channel_results.clone();
    let enriched_channels = tokio::spawn(async move {
        enrich_channels(&ctx_clone, &user_id_clone, channel_results_clone)
            .await
            .map(|v| {
                v.into_iter()
                    .map(UnifiedSearchResponseItem::Channel)
                    .collect::<Vec<UnifiedSearchResponseItem>>()
            })
    });

    let ctx_clone = ctx.clone();
    let user_id_clone = user_context.user_id.clone();
    let project_results_clone = project_results.clone();
    let enriched_projects = tokio::spawn(async move {
        enrich_projects(&ctx_clone, &user_id_clone, project_results_clone)
            .await
            .map(|v| {
                v.into_iter()
                    .map(UnifiedSearchResponseItem::Project)
                    .collect::<Vec<UnifiedSearchResponseItem>>()
            })
    });

    let ctx_clone = ctx.clone();
    let user_id_clone = user_context.user_id.clone();
    let email_results_clone = email_results.clone();
    let enriched_emails = tokio::spawn(async move {
        enrich_emails(&ctx_clone, &user_id_clone, email_results_clone)
            .await
            .map(|v| {
                v.into_iter()
                    .map(UnifiedSearchResponseItem::Email)
                    .collect::<Vec<UnifiedSearchResponseItem>>()
            })
    });

    let (enriched_documents, enriched_chats, enriched_channels, enriched_projects, enriched_emails) =
        tokio::try_join!(
            enriched_documents,
            enriched_chats,
            enriched_channels,
            enriched_projects,
            enriched_emails
        )
        .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    let mut results: Vec<UnifiedSearchResponseItem> = vec![];

    results.extend(enriched_documents?);
    results.extend(enriched_chats?);
    results.extend(enriched_channels?);
    results.extend(enriched_projects?);
    results.extend(enriched_emails?);

    // TODO: sort at the end. need to expose hit score first

    Ok((StatusCode::OK, Json(UnifiedSearchResponse { results })).into_response())
}
