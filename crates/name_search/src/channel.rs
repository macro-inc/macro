//! This module contains logic for searching channels by name.

#[cfg(not(test))]
use cached::proc_macro::cached;
use channels::outbound::channel_name::batch_resolve_channel_names;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use models_search_cursor::{SearchCursorOption, SearchMethodCursor};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::{
    NameSearchError, NameSearchResult, PaginatedResult, SearchEntityType, escape_regex,
    highlight_name,
};

const CANDIDATE_BATCH_SIZE: i64 = 256;

/// Searches the names of channels in which the user is an active participant.
#[tracing::instrument(skip(db), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{ format!("{}-{:?}-{}-{}-{}-{:?}", macro_user_id.as_ref(), channel_ids, term, exact_match, limit, cursor.as_ref().and_then(|c| c.as_updated_at()).map(|(id, ts)| format!("{}-{}", id, ts)).unwrap_or_default()) }"#
    )
)]
pub async fn search_channel_names<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    channel_ids: &[Uuid],
    term: String,
    exact_match: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    search_channel_names_in_batches(
        db,
        macro_user_id,
        channel_ids,
        term,
        exact_match,
        limit,
        cursor,
        CANDIDATE_BATCH_SIZE,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn search_channel_names_in_batches<'a>(
    db: &Pool<Postgres>,
    macro_user_id: &MacroUserId<Lowercase<'a>>,
    channel_ids: &[Uuid],
    term: String,
    exact_match: bool,
    limit: u32,
    cursor: Option<SearchMethodCursor>,
    candidate_batch_size: i64,
) -> Result<PaginatedResult<NameSearchResult>, NameSearchError> {
    if term.is_empty() {
        return Err(NameSearchError::EmptySearchTerm);
    }
    if cursor.as_ref().is_some_and(|c| c.as_updated_at().is_none()) {
        return Err(NameSearchError::IncompatibleCursor);
    }
    if channel_ids.is_empty() {
        return Ok(PaginatedResult {
            items: vec![],
            cursor: SearchCursorOption::Done,
        });
    }

    let mut scan_cursor = cursor
        .as_ref()
        .and_then(|c| c.as_updated_at())
        .map(|(id, ts)| (ts, id));
    let viewer_user_id = MacroUserIdStr(macro_user_id.clone());
    let search_pattern = if exact_match {
        format!(r"(^|\W){}($|\W)", escape_regex(&term))
    } else {
        format!(r"(^|\W){}", escape_regex(&term))
    };
    let match_pattern = regex::Regex::new(&format!("(?i){search_pattern}"))
        .expect("escaped search terms always form valid regexes");
    let match_limit = limit as usize + 1;
    let mut results = Vec::with_capacity(match_limit);

    loop {
        let (cursor_updated_at, cursor_entity_id) = scan_cursor
            .map(|(ts, id)| (Some(ts), Some(id)))
            .unwrap_or((None, None));
        let rows = sqlx::query!(
            r#"
                SELECT
                    c.id as entity_id,
                    c.name,
                    c.updated_at
                FROM comms_channels c
                INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
                WHERE cp.user_id = $1
                    AND cp.left_at IS NULL
                    AND c.id = ANY($2::uuid[])
                    AND (
                        $3::timestamptz IS NULL
                        OR (c.updated_at, c.id) < ($3, $4)
                    )
                    AND (
                        NULLIF(BTRIM(c.name), '') IS NULL
                        OR c.name ~* $5
                    )
                ORDER BY c.updated_at DESC, c.id DESC
                LIMIT $6
            "#,
            macro_user_id.as_ref(),
            channel_ids,
            cursor_updated_at,
            cursor_entity_id,
            search_pattern,
            candidate_batch_size,
        )
        .fetch_all(db)
        .await
        .map_err(NameSearchError::DatabaseError)?;

        if rows.is_empty() {
            break;
        }

        let batch_exhausted = rows.len() < candidate_batch_size as usize;
        let last = rows.last().expect("non-empty batch");
        let next_scan_cursor = (last.updated_at, last.entity_id);
        let candidate_ids: Vec<Uuid> = rows
            .iter()
            .filter(|row| row.name.as_ref().is_none_or(|name| name.trim().is_empty()))
            .map(|row| row.entity_id)
            .collect();
        let mut resolved_names =
            batch_resolve_channel_names(db, &candidate_ids, viewer_user_id.clone())
                .await
                .map_err(NameSearchError::DatabaseError)?;

        for row in rows {
            let name = match row.name.filter(|name| !name.trim().is_empty()) {
                Some(name) => name,
                None => {
                    let Some(name) = resolved_names.remove(&row.entity_id) else {
                        continue;
                    };
                    name
                }
            };
            if !match_pattern.is_match(&name) {
                continue;
            }
            let Some(name) = highlight_name(&name, &term) else {
                continue;
            };
            results.push(NameSearchResult {
                entity_id: row.entity_id,
                entity_type: SearchEntityType::Channels,
                name,
                updated_at: row.updated_at,
            });
            if results.len() == match_limit {
                break;
            }
        }

        if results.len() == match_limit || batch_exhausted {
            break;
        }
        scan_cursor = Some(next_scan_cursor);
    }

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

#[cfg(test)]
mod test;
