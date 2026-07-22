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

    let (cursor_updated_at, cursor_entity_id) = cursor
        .as_ref()
        .and_then(|c| c.as_updated_at())
        .map(|(id, ts)| (Some(ts), Some(id)))
        .unwrap_or((None, None));
    let rows = sqlx::query!(
        r#"
            SELECT
                c.id as entity_id,
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
            ORDER BY c.updated_at DESC, c.id DESC
        "#,
        macro_user_id.as_ref(),
        channel_ids,
        cursor_updated_at,
        cursor_entity_id,
    )
    .fetch_all(db)
    .await
    .map_err(NameSearchError::DatabaseError)?;

    let candidate_ids: Vec<Uuid> = rows.iter().map(|row| row.entity_id).collect();
    let viewer_user_id = MacroUserIdStr(macro_user_id.clone());
    let mut resolved_names = batch_resolve_channel_names(db, &candidate_ids, viewer_user_id)
        .await
        .map_err(NameSearchError::DatabaseError)?;
    let match_pattern = regex::Regex::new(&if exact_match {
        format!(r"(?i)(^|\W){}($|\W)", escape_regex(&term))
    } else {
        format!(r"(?i)(^|\W){}", escape_regex(&term))
    })
    .expect("escaped search terms always form valid regexes");

    let results = rows
        .into_iter()
        .filter_map(|row| {
            let name = resolved_names.remove(&row.entity_id)?;
            if !match_pattern.is_match(&name) {
                return None;
            }
            let name = highlight_name(&name, &term)?;
            Some(NameSearchResult {
                entity_id: row.entity_id,
                entity_type: SearchEntityType::Channels,
                name,
                updated_at: row.updated_at,
            })
        })
        .collect();

    Ok(SearchCursorOption::paginate(results, limit as usize))
}

#[cfg(test)]
mod test;
