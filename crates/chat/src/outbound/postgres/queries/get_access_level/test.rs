use super::granted_level;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// The level the statement gave before it matched by membership: the same
/// grants, against the user's channels, teams and own id listed in the
/// statement.
async fn source_list_level(
    pool: &PgPool,
    user_id: &str,
    chat_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let level = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE source_id = ANY(ARRAY(
            SELECT cp.channel_id::text FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ))
        AND entity_id = $2
        AND entity_type = 'chat'
        ORDER BY
            CASE access_level::text
                WHEN 'owner' THEN 4
                WHEN 'edit' THEN 3
                WHEN 'comment' THEN 2
                WHEN 'view' THEN 1
                ELSE 0
            END DESC
        LIMIT 1
        "#,
        user_id,
        chat_id,
    )
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(level)
}

/// For every user in entity_access's viewer matrix, and one with no rows,
/// each matrix chat (one per grant source, one holding every grant) gets the
/// level the source-list form gave.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../entity_access/fixtures",
        scripts("viewer_matrix", "viewer_matrix_chat")
    )
)]
async fn granted_level_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let chats: Vec<String> = sqlx::query_scalar!(r#"SELECT id AS "id!" FROM "Chat" ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    let mut users: Vec<String> =
        sqlx::query_scalar!(r#"SELECT id AS "id!" FROM "User" ORDER BY id"#)
            .fetch_all(&pool)
            .await?;
    users.push("macro|matrix-stranger@example.com".to_string());

    let mut granted = 0;
    for user in &users {
        for chat in &chats {
            let chat_id = Uuid::parse_str(chat)?;
            let old = source_list_level(&pool, user, chat_id).await?;
            assert_eq!(
                granted_level(&pool, user, chat_id).await?,
                old,
                "{user} on {chat}"
            );
            granted += usize::from(old.is_some());
        }
    }
    anyhow::ensure!(
        users.len() >= 5 && granted >= 15,
        "the fixture gave too few grants: {granted} for {} users",
        users.len()
    );

    // The member reaches chats through its team and a channel, not only its
    // own id. The ids are the fixture's `matrix_item('chat', <source>)`.
    let (team_chat, channel_chat) = sqlx::query!(
        r#"SELECT md5('chat:7a000000-0000-0000-0000-00000000000a')::uuid AS "team!",
                  md5('chat:7a000000-0000-0000-0000-0000000000c1')::uuid AS "channel!""#
    )
    .fetch_one(&pool)
    .await
    .map(|row| (row.team, row.channel))?;
    const MEMBER: &str = "macro|matrix-member@example.com";
    assert_eq!(
        granted_level(&pool, MEMBER, team_chat).await?.as_deref(),
        Some("edit")
    );
    assert_eq!(
        granted_level(&pool, MEMBER, channel_chat).await?.as_deref(),
        Some("comment")
    );
    Ok(())
}
