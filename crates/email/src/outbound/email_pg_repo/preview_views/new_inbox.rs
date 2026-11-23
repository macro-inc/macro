use super::super::db_types::*;
use models_pagination::{Query, SimpleSortMethod};
use sqlx::PgPool;
use uuid::Uuid;

/// Fetches a paginated list of thread previews for a given link_id.
/// Each thread preview includes details from the latest message (inbound or outbound)
/// that is NOT in the 'TRASH' label.
/// The sorting and filtering behavior is determined by the `sort_method` parameter.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn new_inbox_preview_cursor(
    pool: &PgPool,
    link_ids: &[Uuid],
    limit: u32,
    query: &Query<Uuid, SimpleSortMethod, ()>,
) -> Result<Vec<ThreadPreviewCursorDbRow>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = query.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = query.vals();

    sqlx::query_file_as!(
        ThreadPreviewCursorDbRow,
        "src/outbound/email_pg_repo/preview_views/new_inbox.sql",
        link_ids,         // $1
        query_limit,      // $2
        cursor_timestamp, // $3
        cursor_id,        // $4
        sort_method_str,  // $5
    )
    .fetch_all(pool)
    .await
}
