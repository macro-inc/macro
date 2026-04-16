use sqlx::PgPool;
use uuid::Uuid;

/// Share a document with all members of the given user's team.
///
/// Finds team members via the `team_user` join table, then bulk-inserts
/// `entity_access` rows with `comment` access and `source_type = 'user'`.
/// Skips users who already have a direct user-sourced access row so existing
/// permissions (e.g. the owner's `owner` row) are never downgraded.
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

    let document_uuid = macro_uuid::string_to_uuid(document_id)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;

    // Insert comment access for team members who don't already have access.
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT
            $1::uuid,
            'document',
            u.user_id,
            'user',
            'comment'
        FROM UNNEST($2::text[]) AS u(user_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM entity_access ea
            WHERE ea.source_id = u.user_id
              AND ea.entity_id = $1::uuid
              AND ea.entity_type = 'document'
              AND ea.source_type = 'user'
        )
        "#,
        document_uuid,
        &team_members,
    )
    .execute(pool)
    .await?;

    Ok(())
}
