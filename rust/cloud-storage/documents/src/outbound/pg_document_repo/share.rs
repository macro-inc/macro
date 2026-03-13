use sqlx::PgPool;
use uuid::Uuid;

/// Share a document with all members of the given user's team.
///
/// Finds team members via the `team_user` join table, then bulk-inserts
/// `UserItemAccess` rows with `comment` access and a NULL
/// `granted_from_channel_id`. Skips users who already have a direct
/// (non-channel) access row so existing permissions (e.g. the owner's
/// `owner` row) are never downgraded. Channel-granted rows are left
/// untouched and may coexist.
#[tracing::instrument(err, skip(pool))]
pub async fn share_with_team(
    pool: &PgPool,
    user_id: &str,
    document_id: &str,
) -> Result<(), sqlx::Error> {
    // Find all users on the same team(s) as the given user.
    let team_members: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT tu2.user_id
        FROM team_user tu1
        JOIN team_user tu2 ON tu1.team_id = tu2.team_id
        WHERE tu1.user_id = $1
        "#,
        user_id,
    )
    .fetch_all(pool)
    .await?;

    if team_members.is_empty() {
        return Ok(());
    }

    let ids: Vec<Uuid> = team_members
        .iter()
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();

    // Insert comment access for team members who don't already have access.
    // Uses WHERE NOT EXISTS instead of ON CONFLICT because the unique index
    // includes granted_from_channel_id which can be NULL, and PostgreSQL
    // treats NULLs as distinct in unique indexes.
    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess" (
            "id", "user_id", "item_id", "item_type", "access_level",
            "granted_from_channel_id", "created_at", "updated_at"
        )
        SELECT
            u.id,
            u.user_id,
            $1 AS item_id,
            'document' AS item_type,
            'comment' AS access_level,
            NULL AS granted_from_channel_id,
            NOW() AS created_at,
            NOW() AS updated_at
        FROM UNNEST($2::uuid[], $3::text[]) AS u(id, user_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM "UserItemAccess" uia
            WHERE uia."user_id" = u.user_id
              AND uia."item_id" = $1
              AND uia."item_type" = 'document'
              AND uia."granted_from_channel_id" IS NULL
        )
        "#,
        document_id,
        &ids,
        &team_members,
    )
    .execute(pool)
    .await?;

    Ok(())
}
