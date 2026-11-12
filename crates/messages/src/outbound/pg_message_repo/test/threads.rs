use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn thread_pages_preserve_import_order_ties_tombstones_and_bounds(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "message-doc-a").unwrap();
    let root = repo
        .create(command("message-doc-a", None, "root"))
        .await
        .unwrap()
        .0;
    let mut created = Vec::new();
    for (index, import_order) in [
        Some(2_i64),
        None,
        Some(0),
        Some(1),
        None,
        Some(1),
        None,
        None,
    ]
    .into_iter()
    .enumerate()
    {
        let reply = repo
            .create(command("message-doc-a", Some(root.id), "reply"))
            .await
            .unwrap()
            .0;
        let created_at = DateTime::parse_from_rfc3339("2026-01-01T00:00:00.123456Z")
            .unwrap()
            .with_timezone(&Utc)
            + chrono::Duration::seconds((index % 2) as i64);
        sqlx::query!(
            "UPDATE comms_messages SET import_order = $2, created_at = $3 WHERE id = $1",
            reply.id,
            import_order,
            created_at
        )
        .execute(&pool)
        .await
        .unwrap();
        created.push(reply.id);
    }
    repo.delete(&parent, created[6]).await.unwrap();
    let expected = repo.replies(&parent, root.id).await.unwrap();
    assert_eq!(expected.len(), 7);
    assert_eq!(
        expected
            .iter()
            .take(4)
            .map(|message| message.import_order)
            .collect::<Vec<_>>(),
        vec![Some(0), Some(1), Some(1), Some(2)]
    );
    let mut forward = Vec::new();
    let mut cursor = None;
    loop {
        let page = repo
            .thread_page(
                &parent,
                root.id,
                MessageThreadQuery {
                    cursor,
                    limit: Some(2),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(page.root.thread.reply_count, 7);
        assert_eq!(
            page.root
                .thread
                .preview
                .iter()
                .map(|message| message.id)
                .collect::<Vec<_>>(),
            expected
                .iter()
                .take(3)
                .map(|message| message.id)
                .collect::<Vec<_>>()
        );
        assert!(page.replies.len() <= 2);
        forward.extend(page.replies);
        cursor = page.previous_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(
        serde_json::to_value(&forward).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let mut backward = Vec::new();
    let mut cursor = None;
    loop {
        let page = repo
            .thread_page(
                &parent,
                root.id,
                MessageThreadQuery {
                    cursor,
                    direction: MessageDirection::Older,
                    limit: Some(2),
                    around: None,
                },
            )
            .await
            .unwrap();
        backward.splice(0..0, page.replies);
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(
        serde_json::to_value(&backward).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    for index in [0, 3, 6] {
        let page = repo
            .thread_page(
                &parent,
                root.id,
                MessageThreadQuery {
                    around: Some(expected[index].id),
                    limit: Some(3),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let start = index.saturating_sub(1).min(expected.len() - 3);
        assert_eq!(
            page.replies
                .iter()
                .map(|message| message.id)
                .collect::<Vec<_>>(),
            expected[start..start + 3]
                .iter()
                .map(|message| message.id)
                .collect::<Vec<_>>()
        );
        assert_eq!(page.next_cursor.is_some(), start > 0);
        assert_eq!(page.previous_cursor.is_some(), start + 3 < expected.len());
    }
    assert!(matches!(
        repo.thread_page(
            &parent,
            root.id,
            MessageThreadQuery {
                around: Some(created[6]),
                ..Default::default()
            }
        )
        .await,
        Err(MessageError::NotFound)
    ));
    let other_parent = MessageParent::parse("document", "message-doc-b").unwrap();
    assert!(matches!(
        repo.thread_page(&other_parent, root.id, MessageThreadQuery::default())
            .await,
        Err(MessageError::NotFound)
    ));
    let mut before_first = MessageReplyCursor::from_message(&expected[0]);
    before_first.created_at -= chrono::Duration::seconds(1);
    let first = repo
        .thread_page(
            &parent,
            root.id,
            MessageThreadQuery {
                cursor: Some(before_first),
                limit: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(first.next_cursor.is_none());
    let mut after_last = MessageReplyCursor::from_message(expected.last().unwrap());
    after_last.created_at += chrono::Duration::seconds(1);
    let last = repo
        .thread_page(
            &parent,
            root.id,
            MessageThreadQuery {
                cursor: Some(after_last),
                direction: MessageDirection::Older,
                limit: Some(2),
                around: None,
            },
        )
        .await
        .unwrap();
    assert!(last.previous_cursor.is_none());
    assert!(repo.root(&parent, root.id).await.unwrap().is_some());
    assert!(repo.root(&parent, expected[0].id).await.unwrap().is_none());
}
