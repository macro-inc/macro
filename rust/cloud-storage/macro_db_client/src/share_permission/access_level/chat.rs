use models_permissions::share_permission::access_level::AccessLevel;
use std::collections::HashMap;
use std::str::FromStr;

/// Gets the public access level for a chat (no user required).
///
/// This function checks only public `SharePermission` records (where `isPublic=true`),
/// applied either directly to the chat or inherited from its project hierarchy.
/// It does NOT check user-specific `UserItemAccess` records.
///
/// Use this for unauthenticated access to publicly shared chats.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `chat_id` - The ID of the chat to check.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if there is public access.
/// - `Ok(None)` if there is no public access.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_public_access_level_for_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    let public_levels: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE c.id = $1 AND c."deletedAt" IS NULL
            UNION ALL
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id
                AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT "publicAccessLevel" as access_level
        FROM "SharePermission"
        WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
            SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $1
            UNION
            SELECT "sharePermissionId" FROM "ProjectPermission"
            WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
        )
        "#,
        chat_id
    )
    .fetch_all(db)
    .await?;

    let highest_level = public_levels
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

/// Calculates the highest effective access level a user has for a chat.
///
/// This function determines the best possible permission by considering two sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the chat or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the chat or inherited from its project hierarchy.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `chat_id` - The ID of the chat to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_highest_access_level_for_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE c.id = $1 AND c."deletedAt" IS NULL
            UNION ALL
            SELECT parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT access_level FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT access_level::text FROM "UserItemAccess"
            WHERE user_id = $2 AND item_id IN (
                SELECT $1 -- The chat itself
                UNION
                SELECT project_id FROM project_hierarchy -- All parent projects
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $1
                UNION
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        chat_id,
        user_id
    )
        .fetch_all(db)
        .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|optional_string| {
            // `optional_string` is &Option<String>.
            // We use `and_then` to proceed only if it's Some.
            optional_string
                .as_ref()
                .and_then(|s| AccessLevel::from_str(s).ok())
        })
        .max();

    Ok(highest_level)
}

/// Calculates the highest effective access level a user has for multiple chats.
///
/// This is a batch version of `get_highest_access_level_for_chat` that processes
/// multiple chat IDs in a single database query for better performance.
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
        WITH RECURSIVE project_hierarchy AS (
            SELECT c.id as chat_id, p.id as project_id
            FROM "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
            UNION ALL
            SELECT ph.chat_id, parent.id as project_id
            FROM project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        SELECT 
            chat_id,
            access_level
        FROM (
            -- Source 1: Cast the AccessLevel enum to text.
            SELECT 
                ph.chat_id,
                uia.access_level::text as access_level
            FROM project_hierarchy ph
            JOIN "UserItemAccess" uia ON uia.user_id = $2 AND (
                uia.item_id = ph.chat_id OR uia.item_id = ph.project_id
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT 
                ph.chat_id,
                sp."publicAccessLevel" as access_level
            FROM project_hierarchy ph
            JOIN "ProjectPermission" pp ON pp."projectId" = ph.project_id
            JOIN "SharePermission" sp ON sp.id = pp."sharePermissionId" 
                AND sp."isPublic" = true 
                AND sp."publicAccessLevel" IS NOT NULL
            UNION ALL
            -- Source 3: Direct chat permissions
            SELECT 
                c.id as chat_id,
                uia.access_level::text as access_level
            FROM "Chat" c
            JOIN "UserItemAccess" uia ON uia.user_id = $2 AND uia.item_id = c.id
            WHERE c.id = ANY($1) AND c."deletedAt" IS NULL
            UNION ALL
            -- Source 4: Direct chat public permissions
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
