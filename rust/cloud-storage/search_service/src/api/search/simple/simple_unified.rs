use crate::api::search::simple::filter::FilterVariantToSearchArgs;

use crate::api::search::simple::{simple_chat, simple_document, simple_project};
use crate::api::{
    context::SearchHandlerState,
    search::{SearchPaginationParams, simple::SearchError},
};
use axum::{
    Extension,
    extract::{self, State},
    response::Json,
};
use macro_user_id::user_id::MacroUserId;
use model::{response::ErrorResponse, user::UserContext};
use models_search::unified::SearchEntityFilters;
use models_search::{
    SearchOn, SimpleSearchResponse,
    unified::{SimpleUnifiedSearchResponse, UnifiedSearchRequest},
};
use models_search_cursor::{SearchCursor, SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::model::SearchHit;
use opensearch_client::search::unified::UnifiedSearchArgs;

/// Identifies the source of a search result for cursor regeneration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchSource {
    DocumentName,
    ChatName,
    ProjectName,
    Content,
}

/// Wrapper for SearchHit that tracks its source for cursor regeneration
struct TaggedSearchHit {
    hit: SearchHit,
    source: SearchSource,
}

/// Find the last TaggedSearchHit matching a given source
fn find_last_of_source(
    results: &[TaggedSearchHit],
    source: SearchSource,
) -> Option<&TaggedSearchHit> {
    results.iter().rev().find(|h| h.source == source)
}

/// Generate a cursor from a TaggedSearchHit.
fn cursor_from_tagged(tagged: &TaggedSearchHit) -> Option<SearchMethodCursor> {
    tagged
        .hit
        .updated_at
        .map(|ts| SearchMethodCursor::UpdatedAt {
            entity_id: tagged.hit.entity_id,
            updated_at: ts,
        })
}

/// Computes the next cursor for a search source based on pagination state.
fn compute_next_cursor(
    next_cursor_from_search: &SearchCursorOption,
    included_count: usize,
    original_count: usize,
    last_included_hit: Option<&TaggedSearchHit>,
    original_cursor: &SearchCursorOption,
) -> SearchCursorOption {
    if next_cursor_from_search.is_done() {
        SearchCursorOption::Done
    } else if included_count < original_count || next_cursor_from_search.has_more() {
        if included_count > 0 {
            SearchCursorOption::NotDone(last_included_hit.and_then(cursor_from_tagged))
        } else {
            original_cursor.clone()
        }
    } else {
        SearchCursorOption::Done
    }
}

/// Splits search terms by whitespace, preserving double-quoted phrases.
/// e.g. `["hello world"]` → `["hello", "world"]`
/// e.g. `[r#""hello world" test"#]` → `["hello world", "test"]`
fn split_search_terms(terms: &[String]) -> Vec<String> {
    let joined = terms.join(" ");
    let mut result = Vec::new();
    // Regex-free parser: iterate chars, track quoted state
    let mut current = String::new();
    let mut in_quotes = false;
    for c in joined.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    result.push(trimmed);
                }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        result.push(trimmed);
    }
    result
}

/// Creates a unified search request and performs the search
/// by calling individual simple search endpoints for each entity type
#[tracing::instrument(skip(ctx, user_context, query_params), fields(user_id = %user_context.user_id), err)]
pub(in crate::api::search) async fn perform_unified_search(
    ctx: &SearchHandlerState,
    user_context: &UserContext,
    query_params: SearchPaginationParams,
    req: UnifiedSearchRequest,
) -> Result<
    (
        Vec<opensearch_client::search::model::SearchHit>,
        Option<String>,
    ),
    SearchError,
> {
    let user_id = user_context.user_id.clone();

    if user_id.is_empty() {
        return Err(SearchError::NoUserId);
    }
    let user_id = MacroUserId::parse_from_str(&user_id)
        .map_err(|_| SearchError::InvalidUserId(user_id.to_string()))?
        .lowercase();

    let search_on = req.search_on;
    let user_organization_id = user_context.organization_id;
    let collapse = req.collapse.unwrap_or(false);

    // Parse cursor from query params
    let cursor: Option<SearchCursor> = query_params
        .cursor
        .as_ref()
        .and_then(|c| SearchCursor::decode(c));

    if let Some(cursor) = cursor.as_ref()
        && cursor.is_exhausted()
    {
        return Err(SearchError::InvalidCursor);
    }

    let page_size = query_params.page_size.unwrap_or(10);
    if !(0..=100).contains(&page_size) {
        return Err(SearchError::InvalidPageSize);
    }

    let query = req.query.trim().to_string();
    if query.len() < 3 {
        return Err(SearchError::InvalidQuerySize);
    }
    let terms: Vec<String> = vec![query];

    let match_type = req.match_type;

    let search_filters = SearchEntityFilters::from(req.filters);
    let channel_filters = search_filters.channel_filters;
    let email_filters = search_filters.email_filters;
    let chat_filters = search_filters.chat_filters;
    let doc_filters = search_filters.document_filters;
    let project_filters = search_filters.project_filters;
    let call_filters = search_filters.call_filters;

    let should_include_documents = search_filters.should_include_documents;
    let should_include_channels = search_filters.should_include_channels;
    let should_include_chats = search_filters.should_include_chats;
    let should_include_projects = search_filters.should_include_projects;
    let should_include_emails = search_filters.should_include_emails;
    let should_include_call_records = search_filters.should_include_call_records;
    let email_terms = split_search_terms(&terms);

    // Await all tasks in parallel
    let (
        mut filter_document_response,
        mut filter_channel_response,
        mut filter_chat_response,
        mut filter_email_response,
        filter_project_response,
        mut filter_call_record_response,
    ) = tokio::try_join!(
        doc_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_documents,
        ),
        channel_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_channels,
        ),
        chat_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_chats,
        ),
        email_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_emails,
        ),
        project_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_projects
        ),
        call_filters.filter_to_search_args(
            ctx,
            user_id.as_ref(),
            user_organization_id,
            should_include_call_records,
        )
    )
    .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

    // Set terms on each index's search args.
    //
    // Emails always get whitespace-split terms (each term matched
    // independently across many fields, ANDed inside OpenSearch).
    // Documents get split terms only once the alias points at a
    // join-shape index, where each term becomes a separate has_child
    // clause ANDed via bool.must. While the alias still points at the
    // flat-shape index, the documents branch keeps the single adjacent
    // phrase-prefix behavior.
    let document_terms = if opensearch_client::documents_shape::alias_uses_join_shape() {
        split_search_terms(&terms)
    } else {
        terms.clone()
    };
    filter_document_response.terms = document_terms;
    filter_channel_response.terms = terms.clone();
    filter_chat_response.terms = terms.clone();
    filter_email_response.terms = email_terms.clone();
    filter_call_record_response.terms = terms.clone();

    // Clone terms for use in name searches
    let name_search_term = terms[0].clone();

    // Extract individual cursors from the combined cursor (SearchCursorOption)
    // Clone for use in async blocks and for cursor regeneration
    let document_cursor = cursor
        .as_ref()
        .map(|c| c.document_name_cursor.clone())
        .unwrap_or_default();
    let chat_cursor = cursor
        .as_ref()
        .map(|c| c.chat_name_cursor.clone())
        .unwrap_or_default();
    let project_cursor = cursor
        .as_ref()
        .map(|c| c.project_name_cursor.clone())
        .unwrap_or_default();

    let content_cursor = cursor
        .as_ref()
        .map(|c| c.content_cursor.clone())
        .unwrap_or_default();

    // Clone cursors for passing to search functions (originals needed for cursor regeneration)
    let document_cursor_for_search = document_cursor.clone();
    let chat_cursor_for_search = chat_cursor.clone();
    let project_cursor_for_search = project_cursor.clone();
    let content_cursor_for_search = content_cursor.clone();

    let unified_search_args = UnifiedSearchArgs {
        user_id: user_id.as_ref().to_string(),
        page: 0, // With cursor-based pagination, we always start from "page 0" relative to cursor
        page_size,
        cursor: content_cursor_for_search,
        match_type: match_type.to_string(),
        collapse,
        search_indices: {
            let mut indices = std::collections::HashSet::new();
            if should_include_documents
                && !(filter_document_response.ids_only
                    && filter_document_response.document_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::Documents);
            }
            if should_include_chats
                && !(filter_chat_response.ids_only && filter_chat_response.chat_ids.is_empty())
            {
                indices.insert(models_opensearch::OpenSearchEntityType::Chats);
            }
            if should_include_emails {
                indices.insert(models_opensearch::OpenSearchEntityType::Emails);
            }
            if should_include_channels && !filter_channel_response.channel_ids.is_empty() {
                indices.insert(models_opensearch::OpenSearchEntityType::Channels);
            }
            if should_include_call_records && !filter_call_record_response.call_ids.is_empty() {
                indices.insert(models_opensearch::OpenSearchEntityType::CallRecords);
            }
            indices
        },
        document_search_args: filter_document_response.clone(),
        email_search_args: filter_email_response.clone(),
        channel_message_search_args: filter_channel_response,
        chat_search_args: filter_chat_response.clone(),
        call_record_search_args: filter_call_record_response.clone(),
    };

    // Call search functions in parallel for included entity types
    // search_names handles Done cursors internally by returning early
    let (doc_name_results, chat_results, project_results, content_results) = tokio::join!(
        async {
            if should_include_documents {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_document::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_document::FilterDocumentResponse {
                                ids_only: filter_document_response.ids_only,
                                document_ids: filter_document_response.document_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            document_cursor_for_search,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], SearchCursorOption::Done)),
                }
            } else {
                Ok((vec![], SearchCursorOption::Done))
            }
        },
        async {
            if should_include_chats {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_chat::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_chat::FilterChatResponse {
                                ids_only: filter_chat_response.ids_only,
                                chat_ids: filter_chat_response.chat_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            chat_cursor_for_search,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], SearchCursorOption::Done)),
                }
            } else {
                Ok((vec![], SearchCursorOption::Done))
            }
        },
        async {
            if should_include_projects {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_project::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_project::FilterProjectResponse {
                                ids_only: filter_project_response.ids_only,
                                project_ids: filter_project_response.project_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            project_cursor_for_search,
                        )
                        .await
                    }
                    SearchOn::Content => Ok((vec![], SearchCursorOption::Done)),
                }
            } else {
                Ok((vec![], SearchCursorOption::Done))
            }
        },
        async {
            // For Name-only mode, only search emails via OpenSearch (subject field
            // via simple_query_string). Other entity types use PG name searches above.
            let mut args = unified_search_args;
            if matches!(search_on, SearchOn::Name) {
                args.search_indices
                    .retain(|i| *i == models_opensearch::OpenSearchEntityType::Emails);
                args.email_search_args.subject_only = true;
            }
            if args.search_indices.is_empty() {
                Ok((vec![], SearchCursorOption::Done))
            } else if let SearchCursorOption::Done = args.cursor {
                Ok((vec![], SearchCursorOption::Done))
            } else {
                ctx.opensearch_client.search_unified(args).await
            }
        },
    );

    // Extract results and next cursors
    let (doc_hits, doc_next_cursor) = doc_name_results?;
    let (chat_hits, chat_next_cursor) = chat_results?;
    let (project_hits, project_next_cursor) = project_results?;
    let (content_hits, content_next_cursor) = content_results?;

    // Track original counts before combining
    let doc_name_count = doc_hits.len();
    let chat_name_count = chat_hits.len();
    let project_name_count = project_hits.len();
    let content_count = content_hits.len();

    let final_tagged = {
        let _span = tracing::info_span!(
            "combine_and_sort_results",
            doc_name_count,
            chat_name_count,
            project_name_count,
            content_count
        )
        .entered();

        // Wrap results with source tags
        let mut combined: Vec<TaggedSearchHit> = Vec::new();
        combined.extend(doc_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::DocumentName,
        }));
        combined.extend(chat_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::ChatName,
        }));
        combined.extend(project_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::ProjectName,
        }));
        combined.extend(content_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::Content,
        }));

        tracing::debug!(total_combined = combined.len(), "combined all results");

        // Sort: updated_at DESC (None to bottom), entity_id DESC as tiebreaker
        combined.sort_by(|a, b| match (&b.hit.updated_at, &a.hit.updated_at) {
            (Some(b_ts), Some(a_ts)) => b_ts
                .cmp(a_ts)
                .then_with(|| b.hit.entity_id.cmp(&a.hit.entity_id)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.hit.entity_id.cmp(&a.hit.entity_id),
        });

        // Take only page_size results
        let page_size_usize = page_size as usize;
        let final_tagged: Vec<TaggedSearchHit> =
            combined.into_iter().take(page_size_usize).collect();

        tracing::debug!(
            final_count = final_tagged.len(),
            "final results after pagination"
        );

        final_tagged
    };

    let next_cursor = {
        let _span = tracing::info_span!("compute_pagination_cursors").entered();

        // Count included results by source
        let included_doc_names = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::DocumentName)
            .count();
        let included_chat_names = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::ChatName)
            .count();
        let included_project_names = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::ProjectName)
            .count();
        let included_content = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::Content)
            .count();

        // Generate new cursors using helper function
        let new_doc_cursor = compute_next_cursor(
            &doc_next_cursor,
            included_doc_names,
            doc_name_count,
            find_last_of_source(&final_tagged, SearchSource::DocumentName),
            &document_cursor,
        );

        let new_chat_cursor = compute_next_cursor(
            &chat_next_cursor,
            included_chat_names,
            chat_name_count,
            find_last_of_source(&final_tagged, SearchSource::ChatName),
            &chat_cursor,
        );

        let new_project_cursor = compute_next_cursor(
            &project_next_cursor,
            included_project_names,
            project_name_count,
            find_last_of_source(&final_tagged, SearchSource::ProjectName),
            &project_cursor,
        );

        let new_content_cursor = compute_next_cursor(
            &content_next_cursor,
            included_content,
            content_count,
            find_last_of_source(&final_tagged, SearchSource::Content),
            &content_cursor,
        );

        // Build next cursor if any source has more results
        let has_more = new_doc_cursor.has_more()
            || new_chat_cursor.has_more()
            || new_project_cursor.has_more()
            || new_content_cursor.has_more();

        if has_more {
            let cursor = SearchCursor {
                document_name_cursor: new_doc_cursor,
                chat_name_cursor: new_chat_cursor,
                content_cursor: new_content_cursor,
                project_name_cursor: new_project_cursor,
            };
            cursor.encode()
        } else {
            None
        }
    };

    // Extract final SearchHits from tagged results
    let final_results: Vec<SearchHit> = final_tagged.into_iter().map(|t| t.hit).collect();

    Ok((final_results, next_cursor))
}

/// Perform a search through all items.
/// This is a simple search where we do not group your results by entity id.
#[utoipa::path(
    post,
    path = "/search/simple",
    operation_id = "simple_unified_search",
    params(
            ("page_size" = i64, Query, description = "The page size. Defaults to 10."),
            ("cursor" = Option<String>, Query, description = "Base64 encoded cursor for pagination."),
    ),
    responses(
            (status = 200, body=SimpleUnifiedSearchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn handler(
    State(ctx): State<SearchHandlerState>,
    user_context: Extension<UserContext>,
    extract::Query(query_params): extract::Query<SearchPaginationParams>,
    extract::Json(req): extract::Json<UnifiedSearchRequest>,
) -> Result<Json<SimpleSearchResponse>, SearchError> {
    tracing::info!(
        user_id = user_context.user_id,
        query = ?req.query,
        search_on = ?req.search_on,
        "simple_unified_search"
    );

    let (results, _next_cursor) =
        perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    // Note: SimpleSearchResponse doesn't have a next_cursor field
    // The cursor is returned by the unified search endpoint (/search)
    Ok(Json(SimpleSearchResponse { results }))
}

#[cfg(test)]
mod test;
