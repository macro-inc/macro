use crate::NotificationState;
use sqlx::PgPool;

const LEGACY_SCHEMA: &str = include_str!(
    "../../../../macro_db_client/migrations/20260126170641_create_notification_tables.sql"
);
const LEGACY_INDEXES: &str = include_str!(
    "../../../../macro_db_client/migrations/20260225154836_notification_filter_indexes.sql"
);
const UP: &str = include_str!(
    "../../../../macro_db_client/migrations/20260909141557_user_notification_state.up.sql"
);
const DOWN: &str = include_str!(
    "../../../../macro_db_client/migrations/20260909141557_user_notification_state.down.sql"
);

#[sqlx::test(migrations = false)]
async fn migration_normalizes_legacy_states_without_changing_timestamps(
    pool: PgPool,
) -> Result<(), sqlx::Error> {
    // DDL and the pre-cutover fixture cannot be checked against the current
    // development schema. Execute the real migration scripts in an isolated DB.
    sqlx::raw_sql(LEGACY_SCHEMA).execute(&pool).await?;
    sqlx::raw_sql(LEGACY_INDEXES).execute(&pool).await?;
    sqlx::raw_sql(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
         VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'doc', 'document', 'test');
         INSERT INTO user_notification (user_id, notification_id, done, seen_at, sent, deleted_at, created_at)
         VALUES
            ('unseen', '00000000-0000-0000-0000-000000000001', false, NULL, false, NULL, '2020-01-01'),
            ('seen', '00000000-0000-0000-0000-000000000001', false, '2020-01-02', true, NULL, '2020-01-01'),
            ('done', '00000000-0000-0000-0000-000000000001', true, '2020-01-02', true, NULL, '2020-01-01'),
            ('invalid', '00000000-0000-0000-0000-000000000001', true, NULL, false, '2020-01-03', '2020-01-01');",
    ).execute(&pool).await?;

    for _ in 0..2 {
        sqlx::raw_sql(UP).execute(&pool).await?;
        let rows = sqlx::query!(
            r#"SELECT user_id, state as "state!: NotificationState", seen_at, sent, deleted_at, created_at
               FROM user_notification ORDER BY user_id"#,
        ).fetch_all(&pool).await?;
        assert_eq!(rows.len(), 4);
        for row in rows {
            assert_eq!(row.created_at.to_string(), "2020-01-01 00:00:00");
            match row.user_id.as_str() {
                "unseen" => {
                    assert_eq!(row.state, NotificationState::Unseen);
                    assert!(row.seen_at.is_none());
                    assert!(!row.sent);
                    assert!(row.deleted_at.is_none());
                }
                "seen" | "done" => {
                    assert_eq!(row.state, row.user_id.parse::<NotificationState>().unwrap());
                    assert_eq!(row.seen_at.unwrap().to_string(), "2020-01-02 00:00:00");
                    assert!(row.sent);
                    assert!(row.deleted_at.is_none());
                }
                "invalid" => {
                    assert_eq!(row.state, NotificationState::Done);
                    assert!(row.seen_at.is_none(), "do not fabricate a historic view");
                    assert!(!row.sent);
                    assert_eq!(row.deleted_at.unwrap().to_string(), "2020-01-03 00:00:00");
                }
                _ => panic!("unexpected fixture row"),
            }
        }
        sqlx::raw_sql(DOWN).execute(&pool).await?;
    }
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn state_defaults_and_constraints_are_enforced(pool: PgPool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(LEGACY_SCHEMA).execute(&pool).await?;
    sqlx::raw_sql(LEGACY_INDEXES).execute(&pool).await?;
    sqlx::raw_sql(UP).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
         VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'doc', 'document', 'test')",
    ).execute(&pool).await?;
    let state = sqlx::query_scalar!(
        r#"INSERT INTO user_notification (user_id, notification_id)
           VALUES ('user', '00000000-0000-0000-0000-000000000001')
           RETURNING state as "state!: NotificationState""#,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(state, NotificationState::Unseen);

    let invalid = sqlx::query!(
        "UPDATE user_notification SET state = $1::text::notification_state WHERE user_id = 'user'",
        "invalid",
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        invalid.as_database_error().unwrap().code().as_deref(),
        Some("22P02")
    );
    let null = sqlx::query!("UPDATE user_notification SET state = NULL WHERE user_id = 'user'")
        .execute(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        null.as_database_error().unwrap().code().as_deref(),
        Some("23502")
    );
    Ok(())
}
