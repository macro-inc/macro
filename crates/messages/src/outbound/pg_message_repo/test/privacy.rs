use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn private_threads_filter_before_pagination_and_inherit_their_immutable_audience(
    pool: PgPool,
) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let public = repo
        .create(command("message-doc-a", None, "Shared message"))
        .await
        .unwrap();
    let mut private = command("message-doc-a", None, "Private prompt");
    private.visibility = MessageVisibility::Private {
        user_id: USER.into(),
        bot_ids: vec![bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()],
    };
    let private = repo.create(private).await.unwrap();
    // An old or buggy writer cannot widen a reply's audience.
    let reply = repo
        .create(command("message-doc-a", Some(private.id), "Private answer"))
        .await
        .unwrap();
    assert_eq!(reply.visibility, private.visibility);
    // An explicitly private write must never be coerced into a public reply.
    let mut mismatched = command("message-doc-a", Some(public.id), "Must stay private");
    mismatched.visibility = private.visibility.clone();
    assert!(repo.create(mismatched).await.is_err());
    assert_eq!(
        repo.thread(&private.parent, private.id)
            .await
            .unwrap()
            .unwrap()
            .visibility,
        private.visibility
    );
    for viewer in [None, Some("macro|coworker@example.com")] {
        let page = repo
            .timeline(
                &private.parent,
                MessageTimelineQuery {
                    viewer: viewer.map(str::to_owned),
                    limit: Some(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].message.id, public.id);
        assert!(page.next_cursor.is_none());
        assert!(matches!(
            repo.timeline(
                &private.parent,
                MessageTimelineQuery {
                    viewer: viewer.map(str::to_owned),
                    around: Some(private.id),
                    ..Default::default()
                }
            )
            .await,
            Err(MessageError::NotFound)
        ));
    }
    for viewer in [
        USER.to_owned(),
        bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    ] {
        let page = repo
            .timeline(
                &private.parent,
                MessageTimelineQuery {
                    viewer: Some(viewer),
                    around: Some(private.id),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        let root = page
            .items
            .iter()
            .find(|item| item.message.id == private.id)
            .unwrap();
        assert_eq!(root.thread.reply_count, 1);
        assert_eq!(root.thread.preview[0].content, "Private answer");
    }
    assert!(
        sqlx::query!(
            "UPDATE comms_messages SET visibility = '{\"type\":\"public\"}'::jsonb WHERE id = $1",
            private.id
        )
        .execute(&pool)
        .await
        .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bot_context_does_not_mix_private_threads_even_for_the_same_user(pool: PgPool) {
    setup(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let parent = MessageParent::Channel(channel);
    let bot = bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string();
    let visibility = MessageVisibility::Private {
        user_id: USER.into(),
        bot_ids: vec![bot.clone()],
    };
    let mut first = command("message-doc-a", None, "Unrelated private secret");
    first.parent = parent.clone();
    first.visibility = visibility.clone();
    let first = repo.create(first).await.unwrap();
    let mut second = command("message-doc-a", None, "Current private prompt");
    second.parent = parent.clone();
    second.visibility = visibility;
    let second = repo.create(second).await.unwrap();
    let context = repo
        .preceding(&parent, second.id, 50, Some(&bot))
        .await
        .unwrap();
    assert!(!context.iter().any(|message| message.id == first.id));
    let page = repo
        .timeline(
            &parent,
            MessageTimelineQuery {
                viewer: Some(bot),
                viewer_user: Some("macro|other@example.com".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(page.items.is_empty());
}
