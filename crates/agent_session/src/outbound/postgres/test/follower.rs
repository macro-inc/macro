use super::*;

const PROMPTER: &str = "macro|agent-session-prompter@example.com";

/// Following a session records each person once, whoever owns it, and
/// touches neither access nor history: listing it is Soup's job, and who may
/// read it stays with `entity_access`.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn following_records_each_person_once_and_grants_nothing(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot_id = create_test_bot(&pool).await;
    insert_user(&pool, PROMPTER).await;
    let session = create_session(&repo, new_session(bot_id, None, None)).await;
    let access = || async {
        sqlx::query!(
            r#"
            SELECT source_id, access_level::text AS "access_level!"
            FROM entity_access
            WHERE entity_id = $1
            ORDER BY source_id
            "#,
            session.id.as_uuid(),
        )
        .fetch_all(&pool)
        .await
        .expect("read the session's grants")
        .into_iter()
        .map(|row| (row.source_id, row.access_level))
        .collect::<Vec<_>>()
    };
    let history = || async {
        sqlx::query_scalar!(
            r#"SELECT "userId" FROM "UserHistory" WHERE "itemId" = $1 ORDER BY "userId""#,
            session.id.as_uuid().to_string(),
        )
        .fetch_all(&pool)
        .await
        .expect("read the session's history")
    };
    let access_before = access().await;
    let history_before = history().await;

    for user in [PROMPTER, PROMPTER, OWNER] {
        repo.add_follower(session.id, &user_id(user)).await.unwrap();
    }

    let followers = sqlx::query_scalar!(
        "SELECT user_id FROM agent_session_follower WHERE agent_session_id = $1 ORDER BY user_id",
        session.id.as_uuid(),
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(followers, vec![OWNER.to_string(), PROMPTER.to_string()]);
    assert_eq!(access().await, access_before);
    assert_eq!(history().await, history_before);
}
