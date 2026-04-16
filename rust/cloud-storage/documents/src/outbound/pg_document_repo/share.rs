use sqlx::PgPool;
use uuid::Uuid;

/// Share a document with all members of the given user's team.
///
/// Finds team members via the `team_user` join table, then bulk-inserts
/// `UserItemAccess` rows with `comment` access, a NULL
/// `granted_from_channel_id`, and the originating `granted_from_team_id`.
/// Skips users who already have a direct
/// (non-channel) access row so existing permissions (e.g. the owner's
/// `owner` row) are never downgraded. Channel-granted rows are left
/// untouched and may coexist.
#[tracing::instrument(err, skip(pool))]
pub async fn share_with_team(
    pool: &PgPool,
    user_id: &str,
    document_id: &str,
) -> Result<(), sqlx::Error> {
    // Find the team_id for the given user.
    let team_id: Option<Uuid> = sqlx::query_scalar!(
        r#"
        SELECT team_id
        FROM team_user
        WHERE user_id = $1
        LIMIT 1
        "#,
        user_id,
    )
    .fetch_optional(pool)
    .await?;

    let Some(team_id) = team_id else {
        return Ok(());
    };

    // Find all users on the same team.
    let team_members: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT user_id
        FROM team_user
        WHERE team_id = $1
        "#,
        team_id,
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
            "granted_from_channel_id", "granted_from_team_id",
            "created_at", "updated_at"
        )
        SELECT
            u.id,
            u.user_id,
            $1 AS item_id,
            'document' AS item_type,
            'comment' AS access_level,
            NULL AS granted_from_channel_id,
            $4 AS granted_from_team_id,
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
        team_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}
