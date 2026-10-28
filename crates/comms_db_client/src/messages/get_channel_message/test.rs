use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn search_projection_preserves_author_and_sender(pool: sqlx::PgPool) -> anyhow::Result<()> {
    let channel_id = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
    let message_id = macro_uuid::generate_uuid_v7();
    for author in [Some("unique-archive-bot"), None] {
        sqlx::query!(
            r#"
            INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content, imported_author)
            VALUES ($1, 'channel', $2::uuid::text, 'macro|user1@test.com', 'Historical content', $3)
            ON CONFLICT (id) DO UPDATE SET imported_author = EXCLUDED.imported_author
            "#,
            message_id,
            channel_id,
            author,
        )
        .execute(&pool)
        .await?;
        let result = get_channel_message_by_id(&pool, &channel_id, &message_id).await?;
        assert_eq!(result.message.imported_author.as_deref(), author);
        assert_eq!(result.message.sender_id, "macro|user1@test.com");
        assert_eq!(result.message.content, "Historical content");
        assert_eq!(result.message.message_id, message_id);
        assert!(result.mentions.is_empty());
    }
    assert!(
        get_channel_message_by_id(&pool, &Uuid::nil(), &message_id)
            .await
            .is_err()
    );
    Ok(())
}
