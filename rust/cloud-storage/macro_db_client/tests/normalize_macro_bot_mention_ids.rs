use sqlx::{Pool, Postgres};

const NORMALIZED_MACRO_BOT_ID: &str = "bot|00000000-0000-0000-0000-00000000a1a1";
const OTHER_UUID: &str = "11111111-1111-1111-1111-111111111111";
const MIGRATION: &str =
    include_str!("../migrations/20260702200905_normalize_macro_bot_mention_ids.sql");

#[sqlx::test]
async fn migration_normalizes_macro_bot_user_ids_in_message_content(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    create_minimal_tables(&pool).await?;

    sqlx::query(
        r#"
        INSERT INTO comms_messages (id, content)
        VALUES
            ('bare-macro', '<m-user-mention>{"userId":"00000000-0000-0000-0000-00000000a1a1","label":"Macro"}</m-user-mention>'),
            ('spaced-uppercase-key', '<m-user-mention>{"USERID"  :  "00000000-0000-0000-0000-00000000a1a1"}</m-user-mention>'),
            ('already-normalized', '<m-user-mention>{"userId":"bot|00000000-0000-0000-0000-00000000a1a1"}</m-user-mention>'),
            ('other-user', '<m-user-mention>{"userId":"11111111-1111-1111-1111-111111111111"}</m-user-mention>')
        "#,
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;
    // Run it twice to ensure the content rewrite is idempotent.
    run_migration(&pool).await?;

    let rows =
        sqlx::query_as::<_, (String, String)>("SELECT id, content FROM comms_messages ORDER BY id")
            .fetch_all(&pool)
            .await?;

    assert_eq!(
        rows,
        vec![
            (
                "already-normalized".to_owned(),
                format!(
                    r#"<m-user-mention>{{"userId":"{NORMALIZED_MACRO_BOT_ID}"}}</m-user-mention>"#
                ),
            ),
            (
                "bare-macro".to_owned(),
                format!(
                    r#"<m-user-mention>{{"userId":"{NORMALIZED_MACRO_BOT_ID}","label":"Macro"}}</m-user-mention>"#
                ),
            ),
            (
                "other-user".to_owned(),
                format!(r#"<m-user-mention>{{"userId":"{OTHER_UUID}"}}</m-user-mention>"#),
            ),
            (
                "spaced-uppercase-key".to_owned(),
                format!(
                    r#"<m-user-mention>{{"userId":"{NORMALIZED_MACRO_BOT_ID}"}}</m-user-mention>"#
                ),
            ),
        ]
    );

    Ok(())
}

#[sqlx::test]
async fn migration_normalizes_comms_entity_mentions(pool: Pool<Postgres>) -> anyhow::Result<()> {
    create_minimal_tables(&pool).await?;

    sqlx::query(
        r#"
        INSERT INTO comms_entity_mentions (id, entity_type, entity_id)
        VALUES
            ('bot-bare-macro', 'bot', '00000000-0000-0000-0000-00000000a1a1'),
            ('bot-bare-other', 'bot', '11111111-1111-1111-1111-111111111111'),
            ('bot-already-normalized', 'bot', 'bot|00000000-0000-0000-0000-00000000a1a1'),
            ('user-bare-macro', 'user', '00000000-0000-0000-0000-00000000a1a1'),
            ('user-bare-other', 'user', '11111111-1111-1111-1111-111111111111')
        "#,
    )
    .execute(&pool)
    .await?;

    run_migration(&pool).await?;
    // Run it twice to ensure mention-row normalization is idempotent.
    run_migration(&pool).await?;

    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, entity_type, entity_id FROM comms_entity_mentions ORDER BY id",
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(
        rows,
        vec![
            (
                "bot-already-normalized".to_owned(),
                "bot".to_owned(),
                NORMALIZED_MACRO_BOT_ID.to_owned(),
            ),
            (
                "bot-bare-macro".to_owned(),
                "bot".to_owned(),
                NORMALIZED_MACRO_BOT_ID.to_owned(),
            ),
            (
                "bot-bare-other".to_owned(),
                "bot".to_owned(),
                format!("bot|{OTHER_UUID}"),
            ),
            (
                "user-bare-macro".to_owned(),
                "bot".to_owned(),
                NORMALIZED_MACRO_BOT_ID.to_owned(),
            ),
            (
                "user-bare-other".to_owned(),
                "user".to_owned(),
                OTHER_UUID.to_owned(),
            ),
        ]
    );

    Ok(())
}

async fn create_minimal_tables(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE comms_messages (
            id text PRIMARY KEY,
            content text NOT NULL
        );

        CREATE TABLE comms_entity_mentions (
            id text PRIMARY KEY,
            entity_type text NOT NULL,
            entity_id text NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn run_migration(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    for statement in MIGRATION.split(";\n") {
        if !statement.trim().is_empty() {
            sqlx::query(statement).execute(pool).await?;
        }
    }

    Ok(())
}
