use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replay_repairs_only_the_untouched_share_placeholder_without_duplicates(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Instagram).await;
    let mut original = incoming(&c, "shared-reel");
    original.content = "\n[Unsupported Instagram ig_reel; view it in Instagram]".into();
    native.ingest(&c, &original, vec![]).await.unwrap();
    original.message_type = "ig_reel".into();
    original.content =
        "Shared Instagram reel\nAn actual title\n\nhttps://www.instagram.com/reel/Example123/"
            .into();
    native.ingest(&c, &original, vec![]).await.unwrap();
    native.ingest(&c, &original, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, id) = repo
        .message_target(c.id, original.message_id.as_str())
        .await
        .unwrap();
    let stored = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.content, render_message_content(&original));
    assert!(stored.content.contains("<m-link>"));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT effect_revision FROM meta_messaging_message WHERE message_id=$1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
    native
        .revise(&c, &revision(&c, &original, MessageRevision::Deleted))
        .await
        .unwrap();
    native.ingest(&c, &original, vec![]).await.unwrap();
    assert!(
        PgMessageRepository::new(pool)
            .get(&MessageParent::Channel(channel), id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
}

fn revision(
    c: &Connection,
    message: &IncomingMessage,
    change: MessageRevision,
) -> IncomingRevision {
    IncomingRevision {
        account_id: c.account_id.clone(),
        customer_id: message.customer_id.clone(),
        message_id: message.message_id.clone(),
        direction: message.direction,
        timestamp: Utc::now(),
        change,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_edits_reorder_without_new_messages_or_reply_window_changes(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Instagram).await;
    let original = incoming(&c, "edited-message");
    let newest = revision(
        &c,
        &original,
        MessageRevision::Edited {
            text: "Latest <untrusted> & [caption]".into(),
            number: 2,
        },
    );
    native.revise(&c, &newest).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_conversation")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    native.ingest(&c, &original, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, id) = repo
        .message_target(c.id, original.message_id.as_str())
        .await
        .unwrap();
    let window = sqlx::query_scalar!(
        "SELECT standard_window_until FROM meta_messaging_conversation WHERE channel_id=$1",
        channel
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let older = revision(
        &c,
        &original,
        MessageRevision::Edited {
            text: "Older revision".into(),
            number: 1,
        },
    );
    for r in [&newest, &older, &newest] {
        native.revise(&c, r).await.unwrap();
    }
    native.ingest(&c, &original, vec![]).await.unwrap();
    let message = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        message.content,
        plain_markdown("Latest <untrusted> & [caption]")
    );
    assert!(message.edited_at.is_some());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_message")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT standard_window_until FROM meta_messaging_conversation WHERE channel_id=$1",
            channel
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        window
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT effect_revision FROM meta_messaging_message WHERE message_id=$1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unsends_remove_attachments_and_cannot_be_resurrected_by_late_work(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Instagram).await;
    let original = incoming(&c, "deleted-message");
    native.ingest(&c, &original, vec![]).await.unwrap();
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, id) = repo
        .message_target(c.id, original.message_id.as_str())
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    PgMessageRepository::attach_external_file_in(
        &mut tx,
        channel,
        id,
        c.id,
        original.message_id.as_str(),
        Uuid::now_v7(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let deletion = revision(&c, &original, MessageRevision::Deleted);
    native.revise(&c, &deletion).await.unwrap();
    native.revise(&c, &deletion).await.unwrap();
    native
        .revise(
            &c,
            &revision(
                &c,
                &original,
                MessageRevision::Edited {
                    text: "Late edit".into(),
                    number: 9,
                },
            ),
        )
        .await
        .unwrap();
    native.ingest(&c, &original, vec![]).await.unwrap();
    native.media_unavailable(&c, &original).await.unwrap();
    assert!(repo.media_stored(c.id, &original.message_id).await.unwrap());
    let message = PgMessageRepository::new(pool.clone())
        .get(&MessageParent::Channel(channel), id)
        .await
        .unwrap()
        .unwrap();
    assert!(message.deleted_at.is_some());
    assert!(message.content.is_empty());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM comms_attachments WHERE message_id=$1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    let mut tx = pool.begin().await.unwrap();
    assert!(
        PgMessageRepository::attach_external_file_in(
            &mut tx,
            channel,
            id,
            c.id,
            original.message_id.as_str(),
            Uuid::now_v7()
        )
        .await
        .is_err()
    );
    tx.rollback().await.unwrap();
    let early = incoming(&c, "deleted-before-original");
    native
        .revise(&c, &revision(&c, &early, MessageRevision::Deleted))
        .await
        .unwrap();
    native.ingest(&c, &early, vec![]).await.unwrap();
    assert!(repo.media_stored(c.id, &early.message_id).await.unwrap());
    let (_, early_id) = repo
        .message_target(c.id, early.message_id.as_str())
        .await
        .unwrap();
    assert!(
        PgMessageRepository::new(pool)
            .get(&MessageParent::Channel(channel), early_id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revisions_cannot_cross_customer_author_or_reconnect_generation(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Instagram).await;
    let original = incoming(&c, "scoped-message");
    let mut wrong = revision(&c, &original, MessageRevision::Deleted);
    wrong.customer_id = "other-customer".to_owned().try_into().unwrap();
    native.revise(&c, &wrong).await.unwrap();
    native.ingest(&c, &original, vec![]).await.unwrap();
    assert!(native.revise(&c, &wrong).await.is_err());
    wrong.customer_id = original.customer_id.clone();
    wrong.direction = Direction::Outbound;
    assert!(native.revise(&c, &wrong).await.is_err());
    let repo = PgMessagingRepository::new(pool.clone());
    let (channel, id) = repo
        .message_target(c.id, original.message_id.as_str())
        .await
        .unwrap();
    assert!(
        PgMessageRepository::new(pool.clone())
            .get(&MessageParent::Channel(channel), id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_none()
    );
    repo.connect(&c, b"replacement-test-credential", Some(c.id))
        .await
        .unwrap();
    assert!(
        native
            .revise(&c, &revision(&c, &original, MessageRevision::Deleted))
            .await
            .is_err()
    );
}
