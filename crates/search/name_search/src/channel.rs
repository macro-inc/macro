//! Viewer-aware channel name search. Postgres finds the channels whose name,
//! as the viewer sees it, matches (`channels::outbound::channel_name`); the
//! page of hits is then resolved to those names and highlighted.

use channels::domain::models::ChannelType;
use channels::outbound::channel_name::{
    ChannelNameSearch, batch_resolve_channel_names, match_channel_names,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{
    NameSearchError, NameSearchResult, PaginatedResult, SearchEntityType, escape_like,
    escape_regex, highlight::highlight_name_terms,
};

/// Narrows a channel name search beyond the viewer's own participation.
#[derive(Debug, Default)]
pub struct ChannelNameSearchScope<'a> {
    /// Only these channels; empty means every channel the viewer is in.
    pub channel_ids: &'a [Uuid],
    /// Only these channel types; empty means every type.
    pub channel_types: &'a [ChannelType],
}

/// Searches the names of channels in which the user is an active participant,
/// as that user sees them: stored names, and for DMs and unnamed private
/// channels the other participants' names. `term` splits on whitespace and
/// commas; every part must match the stored name or some other participant,
/// as a case-insensitive substring, or as a whole word when `exact_match` is
/// set. Results are newest `updated_at` first with the matched name
/// highlighted.
#[tracing::instrument(
    skip_all,
    fields(
        user_id = %macro_user_id.as_ref(),
        channel_types = ?scope.channel_types,
        channel_id_count = scope.channel_ids.len(),
        term_len = term.len(),
        exact_match,
        limit,
        result_count = tracing::field::Empty,
    ),
    err
)]
pub async fn search_channel_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    scope: ChannelNameSearchScope<'_>,
    term: String,
    exact_match: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    let terms: Vec<&str> = term
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|part| !part.is_empty())
        .collect();
    if terms.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }
    let after = match cursor {
        None => None,
        Some(cursor) => {
            let (entity_id, updated_at) = cursor
                .as_updated_at()
                .ok_or(NameSearchError::IncompatibleCursor)?;
            Some((updated_at, entity_id))
        }
    };
    let patterns: Vec<String> = terms
        .iter()
        .map(|part| {
            if exact_match {
                format!(r"(^|\W){}($|\W)", escape_regex(part))
            } else {
                format!("%{}%", escape_like(part))
            }
        })
        .collect();
    let viewer_user_id = MacroUserIdStr(macro_user_id.clone());

    let matches = match_channel_names(
        db,
        ChannelNameSearch {
            viewer_user_id: viewer_user_id.clone(),
            patterns: &patterns,
            regex_patterns: exact_match,
            channel_ids: scope.channel_ids,
            channel_types: scope.channel_types,
            after,
            limit: i64::from(limit) + 1,
        },
    )
    .await?;
    let channel_ids: Vec<Uuid> = matches.iter().map(|hit| hit.channel_id).collect();
    let mut names = batch_resolve_channel_names(db, &channel_ids, viewer_user_id).await?;

    let results: Vec<NameSearchResult> = matches
        .into_iter()
        .filter_map(|hit| {
            let name = names.remove(&hit.channel_id)?;
            let highlighted = highlight_name_terms(&name, &terms);
            Some(NameSearchResult {
                entity_id: hit.channel_id,
                entity_type: SearchEntityType::Channels,
                name: highlighted.unwrap_or(name),
                updated_at: hit.updated_at,
            })
        })
        .collect();
    tracing::Span::current().record("result_count", results.len());

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

#[cfg(test)]
mod test;
