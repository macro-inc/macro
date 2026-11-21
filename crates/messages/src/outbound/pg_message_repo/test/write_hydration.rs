use super::*;

async fn matches_ordinary_read(repo: &PgMessageRepository, written: &Message) {
    let read = repo
        .get(&written.parent, written.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(written).unwrap(),
        serde_json::to_value(read).unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_write_hydration_matches_reads_through_message_lifecycle(pool: PgPool) {
    setup(&pool).await;
    let parent = MessageParent::Channel(sequences::channel_fixture(&pool).await);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "initial message");
    input.parent = parent.clone();
    input.input.mentions = vec![
        SimpleMention {
            entity_type: "user".into(),
            entity_id: USER.into(),
        },
        SimpleMention {
            entity_type: "document".into(),
            entity_id: "message-doc-b".into(),
        },
    ];
    input.input.attachments = vec![
        NewAttachment {
            entity_type: "document".into(),
            entity_id: "message-doc-b".into(),
            width: Some(900),
            height: Some(600),
        },
        NewAttachment {
            entity_type: "document".into(),
            entity_id: "message-doc-a".into(),
            width: None,
            height: None,
        },
    ];
    let (created, _) = repo.create(input).await.unwrap();
    assert_eq!(created.mentions.len(), 2);
    assert_eq!(created.attachments.len(), 2);
    assert!(created.bot_profile.is_none());
    matches_ordinary_read(&repo, &created).await;

    for (user, emoji) in [
        (USER, "👍"),
        ("macro|another@example.com", "👍"),
        (USER, "🎉"),
    ] {
        let reaction = repo
            .react(&parent, created.id, user, emoji, true)
            .await
            .unwrap();
        matches_ordinary_read(&repo, &reaction.message).await;
    }
    let unchanged = repo
        .react(&parent, created.id, USER, "👍", true)
        .await
        .unwrap();
    assert!(!unchanged.changed);
    assert_eq!(unchanged.message.reactions.len(), 2);
    matches_ordinary_read(&repo, &unchanged.message).await;

    let (edited, _) = repo
        .edit(
            &parent,
            created.id,
            EditMessage {
                notification_policy: Default::default(),
                content: "edited message".into(),
                mentions: created.mentions.clone(),
                attachments: None,
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.content, "edited message");
    assert_eq!(edited.attachments.len(), 2);
    assert!(edited.edited_at.is_some());
    matches_ordinary_read(&repo, &edited).await;

    let mut reply = command("message-doc-a", Some(created.id), "reply");
    reply.parent = parent.clone();
    let (reply, _) = repo.create(reply).await.unwrap();
    assert_eq!(reply.thread_id, Some(created.id));
    matches_ordinary_read(&repo, &reply).await;

    let (deleted, _) = repo.delete(&parent, created.id).await.unwrap();
    assert!(deleted.deleted_at.is_some());
    assert!(deleted.content.is_empty());
    assert!(deleted.attachments.is_empty());
    assert!(deleted.mentions.is_empty());
    assert!(deleted.reactions.is_empty());
    matches_ordinary_read(&repo, &deleted).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_write_hydration_preserves_system_deleted_and_unknown_bot_profiles(pool: PgPool) {
    setup(&pool).await;
    let parent = MessageParent::Channel(sequences::channel_fixture(&pool).await);
    let deleted_bot = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO bots (id, kind, owner_user_id, name, handle, avatar_url, deleted_at) \
         VALUES ($1, 'owned', $2, 'Historical Agent', 'hydration-agent', 'https://example.com/avatar.png', now())",
        deleted_bot,
        USER,
    ).execute(&pool).await.unwrap();
    let repo = PgMessageRepository::new(pool);
    for (bot, expected_profile) in [
        (
            bot_id::MACRO_AI_BOT_ID,
            bot_id::system_bot(bot_id::MACRO_AI_BOT_ID).map(|bot| BotSenderProfile {
                name: bot.name.to_owned(),
                avatar_url: None,
            }),
        ),
        (
            bot_id::BotId::new_from_uuid(deleted_bot),
            Some(BotSenderProfile {
                name: "Historical Agent".into(),
                avatar_url: Some("https://example.com/avatar.png".into()),
            }),
        ),
        (bot_id::BotId::new_from_uuid(Uuid::now_v7()), None),
    ] {
        let mut input = command("message-doc-a", None, "agent message");
        input.parent = parent.clone();
        input.actor = ChannelSender::new_from_bot(bot);
        input.triggered_by = Some(USER.to_owned());
        input.triggered_via = Some("test-client".into());
        let (created, _) = repo.create(input).await.unwrap();
        assert_eq!(created.bot_profile, expected_profile);
        assert_eq!(created.triggered_by.as_deref(), Some(USER));
        assert_eq!(created.triggered_via.as_deref(), Some("test-client"));
        matches_ordinary_read(&repo, &created).await;
        let (deleted, _) = repo.delete(&parent, created.id).await.unwrap();
        assert_eq!(deleted.bot_profile, expected_profile);
        matches_ordinary_read(&repo, &deleted).await;
    }
}
