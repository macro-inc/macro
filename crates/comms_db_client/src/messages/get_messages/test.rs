use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const CHANNEL: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const OTHER_CHANNEL: Uuid = Uuid::from_u128(0x33333333_3333_3333_3333_333333333333);

async fn seed(pool: &Pool<Postgres>) -> Result<Vec<Uuid>> {
    let mut ids: Vec<_> = (0..4).map(|_| macro_uuid::generate_uuid_v7()).collect();
    ids.sort_unstable();
    sqlx::query!(
        r#"
        INSERT INTO comms_messages (id, channel_id, sender_id, content, created_at, deleted_at)
        SELECT id, channel_id, 'macro|user1@test.com', 'history',
               '2020-01-01T00:00:00.123456Z'::timestamptz, deleted_at
        FROM UNNEST($1::uuid[], $2::uuid[], $3::timestamptz[]) AS rows(id, channel_id, deleted_at)
        "#,
        &ids,
        &[CHANNEL, CHANNEL, OTHER_CHANNEL, CHANNEL],
        &[None, None, None, Some(Utc::now())] as &[Option<DateTime<Utc>>],
    )
    .execute(pool)
    .await?;
    Ok(ids)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn backfill_includes_replies_but_not_document_messages(pool: Pool<Postgres>) -> Result<()> {
    let messages = seed(&pool).await?;
    let reply = macro_uuid::generate_uuid_v7();
    let document_message = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content, created_at)
        VALUES ($1, 'channel', $2, $3, 'macro|user1@test.com', 'reply', '2020-01-02T00:00:00Z'),
               ($4, 'document', 'doc-backfill-test', NULL, 'macro|user1@test.com', 'document', '2020-01-02T00:00:00Z')
        "#,
        reply,
        CHANNEL.to_string(),
        messages[0],
        document_message,
    )
    .execute(&pool)
    .await?;
    let mut cursor = None;
    let mut found = Vec::new();
    loop {
        let page = get_channel_messages_for_search_backfill(&pool, 1, cursor, None, None).await?;
        let Some(row) = page.last() else { break };
        cursor = Some((row.created_at, row.message_id));
        found.extend(ids(&page));
    }
    assert_eq!(found, [messages, vec![reply]].concat());
    Ok(())
}

fn ids(rows: &[ChannelMessageBackfillRow]) -> Vec<Uuid> {
    rows.iter().map(|row| row.message_id).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn backfill_scope_and_deletion_filters(pool: Pool<Postgres>) -> Result<()> {
    let messages = seed(&pool).await?;
    let all = get_channel_messages_for_search_backfill(&pool, 10, None, None, None).await?;
    assert_eq!(ids(&all), messages);

    for (filter, expected) in [
        (None, vec![messages[0], messages[1], messages[3]]),
        (Some(false), vec![messages[0], messages[1]]),
        (Some(true), vec![messages[3]]),
    ] {
        let rows =
            get_channel_messages_for_search_backfill(&pool, 10, None, Some(&[CHANNEL]), filter)
                .await?;
        assert_eq!(ids(&rows), expected);
        assert!(rows.iter().all(|row| row.channel_id == CHANNEL));
    }
    for scope in [vec![], vec![Uuid::nil()]] {
        assert!(
            get_channel_messages_for_search_backfill(&pool, 10, None, Some(&scope), None)
                .await?
                .is_empty()
        );
    }
    let multiple = get_channel_messages_for_search_backfill(
        &pool,
        10,
        None,
        Some(&[CHANNEL, OTHER_CHANNEL, CHANNEL]),
        None,
    )
    .await?;
    assert_eq!(ids(&multiple), messages);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn backfill_keyset_preserves_timestamp_ties_after_deletion(
    pool: Pool<Postgres>,
) -> Result<()> {
    let messages = seed(&pool).await?;
    let first =
        get_channel_messages_for_search_backfill(&pool, 1, None, Some(&[CHANNEL]), Some(false))
            .await?;
    assert_eq!(ids(&first), vec![messages[0]]);
    let cursor = Some((first[0].created_at, first[0].message_id));
    // Removing a row from the active scan would shift an offset past the next
    // message. The keyset must still return the other row at this timestamp.
    sqlx::query!(
        "UPDATE comms_messages SET deleted_at = now() WHERE id = $1",
        messages[0]
    )
    .execute(&pool)
    .await?;
    let second =
        get_channel_messages_for_search_backfill(&pool, 1, cursor, Some(&[CHANNEL]), Some(false))
            .await?;
    assert_eq!(ids(&second), vec![messages[1]]);
    assert_eq!(first[0].created_at, second[0].created_at);
    let end = get_channel_messages_for_search_backfill(
        &pool,
        1,
        Some((second[0].created_at, second[0].message_id)),
        Some(&[CHANNEL]),
        Some(false),
    )
    .await?;
    assert!(end.is_empty());
    Ok(())
}
