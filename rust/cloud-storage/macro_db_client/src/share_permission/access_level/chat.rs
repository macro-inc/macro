use models_permissions::share_permission::access_level::AccessLevel;
use std::collections::HashMap;
use std::str::FromStr;

/// Calculates the highest effective access level a user has for multiple chats.
///
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `chat_ids` - A slice of chat IDs to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing a `HashMap<String, Option<AccessLevel>>`:
/// - Keys are chat IDs from the input
/// - Values are `Some(AccessLevel)` if the user has access, `None` if no access
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_highest_access_level_for_chats(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_ids: &[String],
    user_id: &str,
) -> anyhow::Result<HashMap<String, Option<AccessLevel>>> {
    if chat_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let records = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $2
            UNION ALL
            SELECT $2
        )
        SELECT
            chat_id,
            access_level
        FROM (
            -- Source 1: entity_access for chats
            SELECT
                ea.entity_id::text as chat_id,
                ea.access_level::text as access_level
            FROM entity_access ea
            WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
                AND ea.entity_id = ANY(SELECT id::uuid FROM "Chat" WHERE id = ANY($1) AND "deletedAt" IS NULL)
                AND ea.entity_type = 'chat'
            UNION ALL
            -- Source 2: Direct chat public permissions
            SELECT
                c.id as chat_id,
                sp."publicAccessLevel" as access_level
            FROM "Chat" c
            JOIN "ChatPermission" cp ON cp."chatId" = c.id
            JOIN "SharePermission" sp ON sp.id = cp."sharePermissionId"
                AND sp."isPublic" = true
                AND sp."publicAccessLevel" IS NOT NULL
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
        ) as all_levels
        "#,
        chat_ids,
        user_id
    )
    .fetch_all(db)
    .await?;

    // Group by chat_id and find highest access level for each
    let mut chat_access_levels: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for record in records {
        if let Some(chat_id) = record.chat_id {
            chat_access_levels
                .entry(chat_id)
                .or_default()
                .push(record.access_level);
        }
    }

    // Convert to final result with highest access level per chat
    let mut result = HashMap::new();

    // Initialize all chat IDs with None (no access)
    for chat_id in chat_ids {
        result.insert(chat_id.clone(), None);
    }

    // Update with actual access levels
    for (chat_id, level_strings) in chat_access_levels {
        let highest_level = level_strings
            .iter()
            .filter_map(|optional_string| {
                optional_string
                    .as_ref()
                    .and_then(|s| AccessLevel::from_str(s).ok())
            })
            .max();

        result.insert(chat_id, highest_level);
    }

    Ok(result)
}

#[cfg(test)]
#[path = "chat_tests.rs"]
mod tests;
