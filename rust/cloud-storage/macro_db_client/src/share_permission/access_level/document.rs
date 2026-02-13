use models_permissions::share_permission::access_level::AccessLevel;
use std::str::FromStr;

/// Gets the public access level for a document (no user required).
///
/// This function checks only public `SharePermission` records (where `isPublic=true`),
/// applied either directly to the document or inherited from its project hierarchy.
/// It does NOT check user-specific `UserItemAccess` records.
///
/// Use this for unauthenticated access to publicly shared documents.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `document_id` - The ID of the document to check.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if there is public access.
/// - `Ok(None)` if there is no public access.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_public_access_level_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    let public_levels: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Document" d
            JOIN "Project" p ON d."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE d.id = $1 AND d."deletedAt" IS NULL
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
            SELECT "sharePermissionId" FROM "DocumentPermission" WHERE "documentId" = $1
            UNION
            SELECT "sharePermissionId" FROM "ProjectPermission"
            WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
        )
        "#,
        document_id
    )
    .fetch_all(db)
    .await?;

    let highest_level = public_levels
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

/// Calculates the highest effective access level a user has for a document.
///
/// This function determines the best possible permission by considering three sources:
/// 1.  **Explicit Grants**: Any `UserItemAccess` records for the specified user, applied either
///     directly to the document or inherited from its entire project hierarchy.
/// 2.  **Public Access**: Any `SharePermission` records marked as `isPublic=true`, applied either
///     directly to the document or inherited from its project hierarchy.
/// 3.  **Email Thread Inheritance**: If the document is an email attachment, the user's access
///     to the parent email thread is also considered.
///
/// It combines all possible access levels from these sources, sorts them from highest (`Owner`)
/// to lowest (`View`), and returns the single highest level.
///
/// # Arguments
/// * `db` - A reference to the `sqlx` database connection pool.
/// * `document_id` - The ID of the document to check.
/// * `user_id` - The ID of the user whose access is being checked.
///
/// # Returns
/// A `Result` containing an `Option<AccessLevel>`:
/// - `Ok(Some(AccessLevel))` if the user has any level of access.
/// - `Ok(None)` if the user has no access at all.
/// - `Err(_)` if a database error occurs.
#[tracing::instrument(skip(db), err)]
pub async fn get_highest_access_level_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // Run the document access query and the email thread lookup concurrently
    let (doc_access_result, thread_id_result) = tokio::join!(
        get_document_direct_access_level(db, document_id, user_id),
        get_parent_thread_id_for_document(db, document_id)
    );

    let mut highest_level = doc_access_result?;

    // If the document is an email attachment, also check the user's access to the parent thread
    if let Some(thread_id) = thread_id_result? {
        let thread_access =
            super::thread::get_highest_access_level_for_thread(db, &thread_id, user_id).await?;
        highest_level = std::cmp::max(highest_level, thread_access);
    }

    Ok(highest_level)
}

/// Gets the document's direct access level from UserItemAccess and public SharePermissions.
#[tracing::instrument(skip(db), err)]
async fn get_document_direct_access_level(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    user_id: &str,
) -> anyhow::Result<Option<AccessLevel>> {
    // have to use strings because the SharePermission and UserItemAccess access_level rows use different sql types
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE project_hierarchy AS (
            SELECT p.id as project_id
            FROM "Document" d
            JOIN "Project" p ON d."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE d.id = $1 AND d."deletedAt" IS NULL
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
                SELECT $1
                UNION
                SELECT project_id FROM project_hierarchy
            )
            UNION ALL
            -- Source 2: Select the publicAccessLevel (which is already text).
            SELECT "publicAccessLevel" as access_level
            FROM "SharePermission"
            WHERE "isPublic" = true AND "publicAccessLevel" IS NOT NULL AND id IN (
                SELECT "sharePermissionId" FROM "DocumentPermission" WHERE "documentId" = $1
                UNION
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" IN (SELECT project_id FROM project_hierarchy)
            )
        ) as all_levels
        "#,
        document_id,
        user_id
    )
    .fetch_all(db)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|optional_string| {
            optional_string
                .as_ref()
                .and_then(|s| AccessLevel::from_str(s).ok())
        })
        .max();

    Ok(highest_level)
}

/// If a document is an email attachment, returns the thread ID it belongs to.
#[tracing::instrument(skip(db), err)]
async fn get_parent_thread_id_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
) -> anyhow::Result<Option<String>> {
    let result = sqlx::query_scalar!(
        r#"
        SELECT et.id::text as "thread_id!"
        FROM document_email de
        JOIN email_attachments ea ON de.email_attachment_id = ea.id
        JOIN email_messages em ON ea.message_id = em.id
        JOIN email_threads et ON em.thread_id = et.id
        WHERE de.document_id = $1
        LIMIT 1
        "#,
        document_id
    )
    .fetch_optional(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
#[path = "document_tests.rs"]
mod tests;
