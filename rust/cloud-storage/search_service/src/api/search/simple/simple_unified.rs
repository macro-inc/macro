use crate::api::search::simple::filter::FilterVariantToSearchArgs;

use crate::api::search::simple::{simple_chat, simple_document, simple_email, simple_project};
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
use models_search::unified::generate_unified_search_indices;
use models_search::{
    SearchOn, SimpleSearchResponse,
    unified::{SimpleUnifiedSearchResponse, UnifiedSearchIndex, UnifiedSearchRequest},
};
use models_search_cursor::{SearchCursor, SearchCursorOption, SearchMethodCursor};
use opensearch_client::search::model::SearchHit;
use opensearch_client::search::unified::UnifiedSearchArgs;

/// Identifies the source of a search result for cursor regeneration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchSource {
    DocumentName,
    ChatName,
    EmailSubject,
    EmailContact,
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

/// Generate a cursor from a TaggedSearchHit
fn cursor_from_tagged(tagged: &TaggedSearchHit) -> Option<SearchMethodCursor> {
    tagged.hit.updated_at.map(|ts| SearchMethodCursor {
        entity_id: tagged.hit.entity_id,
        updated_at: ts,
    })
}

/// Computes the next cursor for a search source based on pagination state
///
/// # Arguments
/// * `next_cursor_from_search` - The cursor returned by the search operation
/// * `included_count` - Number of results from this source included in final page
/// * `original_count` - Total number of results returned by search for this source
/// * `last_included_hit` - The last result of this source type included in final page
/// * `original_cursor` - The cursor passed into the search (to carry forward if no results included)
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

/// Creates a unified search request and performs the search
/// by calling individual simple search endpoints for each entity type
#[tracing::instrument(skip(ctx, user_context, query_params, req), err)]
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

    let terms: Vec<String> = match (req.terms.clone(), req.query.clone()) {
        (Some(terms), _) => terms.into_iter().filter(|t| t.len() >= 3).collect(),
        (None, Some(query)) if query.len() >= 3 => vec![query],
        (None, Some(_)) => {
            return Err(SearchError::InvalidQuerySize);
        }
        _ => vec![],
    };

    if terms.is_empty() {
        return Err(SearchError::NoQueryOrTermsProvided);
    }

    let match_type = req.match_type;
    let disable_recency = req.disable_recency;
    let include = req.include;

    let filters = req.filters.unwrap_or_default();
    let channel_filters = filters.channel.unwrap_or_default();
    let email_filters = filters.email.unwrap_or_default();
    let chat_filters = filters.chat.unwrap_or_default();
    let doc_filters = filters.document.unwrap_or_default();
    let project_filters = filters.project.unwrap_or_default();

    let should_include_documents =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Documents);
    let should_include_channels =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Channels);
    let should_include_chats = include.is_empty() || include.contains(&UnifiedSearchIndex::Chats);
    let should_include_projects =
        include.is_empty() || include.contains(&UnifiedSearchIndex::Projects);
    let should_include_emails = include.is_empty() || include.contains(&UnifiedSearchIndex::Emails);

    // Await all tasks in parallel
    let (
        filter_document_response,
        filter_channel_response,
        filter_chat_response,
        filter_email_response,
        filter_project_response,
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
        )
    )
    .map_err(|e| SearchError::InternalError(anyhow::anyhow!("tokio error: {:?}", e)))?;

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
    let email_cursor = cursor
        .as_ref()
        .map(|c| c.email_subject_cursor.clone())
        .unwrap_or_default();
    let email_contact_cursor = cursor
        .as_ref()
        .map(|c| c.email_contact_cursor.clone())
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
    let email_cursor_for_search = email_cursor.clone();
    let email_contact_cursor_for_search = email_contact_cursor.clone();
    let project_cursor_for_search = project_cursor.clone();
    let content_cursor_for_search = content_cursor.clone();

    let unified_search_args = UnifiedSearchArgs {
        terms,
        user_id: user_id.as_ref().to_string(),
        page: 0, // With cursor-based pagination, we always start from "page 0" relative to cursor
        page_size,
        cursor: content_cursor_for_search,
        match_type: match_type.to_string(),
        search_on: search_on.into(),
        collapse,
        disable_recency,
        search_indices: generate_unified_search_indices(include),
        document_search_args: filter_document_response.clone(),
        email_search_args: filter_email_response.clone(),
        channel_message_search_args: filter_channel_response,
        chat_search_args: filter_chat_response.clone(),
    };

    // Call search functions in parallel for included entity types
    // search_names handles Done cursors internally by returning early
    let (
        doc_name_results,
        chat_results,
        email_results,
        email_contact_results,
        project_results,
        content_results,
    ) = tokio::join!(
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
            if should_include_emails {
                match search_on {
                    SearchOn::Name | SearchOn::NameContent => {
                        simple_email::search_names(
                            &ctx.db,
                            &user_id,
                            &simple_email::FilterEmailResponse {
                                ids_only: false,
                                thread_ids: filter_email_response.thread_ids,
                            },
                            name_search_term.clone(),
                            page_size,
                            email_cursor_for_search,
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
            if should_include_emails {
                match search_on {
                    SearchOn::NameContent => {
                        simple_email::search_contacts(
                            &ctx.db,
                            user_id.clone(),
                            name_search_term.clone(),
                            page_size,
                            email_contact_cursor_for_search,
                        )
                        .await
                    }
                    SearchOn::Name | SearchOn::Content => Ok((vec![], SearchCursorOption::Done)),
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
            // We only want to search over content if you are not searching name only
            match search_on {
                SearchOn::Content | SearchOn::NameContent => {
                    if let SearchCursorOption::Done = unified_search_args.cursor {
                        Ok((vec![], SearchCursorOption::Done))
                    } else {
                        ctx.opensearch_client
                            .search_unified(unified_search_args)
                            .await
                    }
                }
                SearchOn::Name => Ok((vec![], SearchCursorOption::Done)),
            }
        },
    );

    // Extract results and next cursors
    let (doc_hits, doc_next_cursor) = doc_name_results?;
    let (chat_hits, chat_next_cursor) = chat_results?;
    let (email_hits, email_next_cursor) = email_results?;
    let (email_contact_hits, email_contact_next_cursor) = email_contact_results?;
    let (project_hits, project_next_cursor) = project_results?;
    let (content_hits, content_next_cursor) = content_results?;

    // Track original counts before combining
    let doc_name_count = doc_hits.len();
    let chat_name_count = chat_hits.len();
    let email_subject_count = email_hits.len();
    let email_contact_count = email_contact_hits.len();
    let project_name_count = project_hits.len();
    let content_count = content_hits.len();

    let final_tagged = {
        let _span = tracing::info_span!(
            "combine_and_sort_results",
            doc_name_count,
            chat_name_count,
            email_subject_count,
            email_contact_count,
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
        combined.extend(email_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::EmailSubject,
        }));
        combined.extend(email_contact_hits.into_iter().map(|hit| TaggedSearchHit {
            hit,
            source: SearchSource::EmailContact,
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
        let included_email_subjects = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::EmailSubject)
            .count();
        let included_email_contacts = final_tagged
            .iter()
            .filter(|h| h.source == SearchSource::EmailContact)
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

        let new_email_cursor = compute_next_cursor(
            &email_next_cursor,
            included_email_subjects,
            email_subject_count,
            find_last_of_source(&final_tagged, SearchSource::EmailSubject),
            &email_cursor,
        );

        let new_email_contact_cursor = compute_next_cursor(
            &email_contact_next_cursor,
            included_email_contacts,
            email_contact_count,
            find_last_of_source(&final_tagged, SearchSource::EmailContact),
            &email_contact_cursor,
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
            || new_email_cursor.has_more()
            || new_email_contact_cursor.has_more()
            || new_project_cursor.has_more()
            || new_content_cursor.has_more();

        if has_more {
            let cursor = SearchCursor {
                document_name_cursor: new_doc_cursor,
                chat_name_cursor: new_chat_cursor,
                content_cursor: new_content_cursor,
                email_subject_cursor: new_email_cursor,
                email_contact_cursor: new_email_contact_cursor,
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
    tracing::info!(user_id = user_context.user_id, "simple_unified_search");

    let (results, _next_cursor) =
        perform_unified_search(&ctx, &user_context, query_params, req).await?;

    let results = results.into_iter().map(|a| a.into()).collect();

    // Note: SimpleSearchResponse doesn't have a next_cursor field
    // The cursor is returned by the unified search endpoint (/search)
    Ok(Json(SimpleSearchResponse { results }))
}

#[cfg(test)]
mod test;
