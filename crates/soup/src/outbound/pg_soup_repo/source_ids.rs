use sqlx::PgPool;

/// Queries bind the result as a `text[]` constant instead of joining a CTE.
/// Postgres estimates a constant `source_id = ANY(...)` from the column's
/// statistics, but costs a CTE join at the average source's grant count, which
/// misplans users who hold hundreds of thousands of grants.
pub(super) async fn user_source_ids(
    db: &PgPool,
    user_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT cp.channel_id::text AS "source_id!" FROM comms_channel_participants cp
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
        UNION ALL
        SELECT t.team_id::text FROM team_user t
            WHERE t.user_id = $1
        UNION ALL
        SELECT $1
        "#,
        user_id
    )
    .fetch_all(db)
    .await
}
