//! SQL query functions for entity access checks.
//!
//! Each module contains a single query function for checking access to a specific entity type.

#[cfg(not(test))]
use cached::proc_macro::cached;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};

pub mod call_channel;
pub mod channel_membership;
pub mod channel_role;
pub mod channel_users;
pub mod chat_access;
pub mod chat_users;
pub mod document_access;
pub mod document_users;
pub mod project_access;
pub mod project_users;
pub mod thread_access;
pub mod thread_users;

/// Type safety for source ids for entity_access table
#[derive(Debug, Clone)]
pub(in crate::outbound::pg_access_repo) struct SourceIds(pub Vec<String>);

/// Grabs the users source ids for the entity access table
/// NOTE: This could return an empty list in the event the user is not logged in and attempting to review a resource
#[tracing::instrument(skip(pool), err)]
#[cfg_attr(
    not(test),
    cached(
        time = 30,
        result = true,
        key = "String",
        convert = r#"{format!("{}", user_id.map(AsRef::as_ref).unwrap_or(""))}"#,
    )
)]
pub(in crate::outbound::pg_access_repo) async fn get_user_source_ids(
    pool: &Pool<Postgres>,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> anyhow::Result<SourceIds> {
    if let Some(user_id) = user_id {
        // Fetch source IDs first
        let source_ids = sqlx::query_scalar!(
            r#"
            SELECT cp.channel_id::text FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
            "#,
            user_id.as_ref()
        )
        .fetch_all(pool)
        .await?;

        let source_ids: Vec<String> = source_ids.into_iter().flatten().collect();

        Ok(SourceIds(source_ids))
    } else {
        Ok(SourceIds(vec![]))
    }
}
