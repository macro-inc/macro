use super::*;

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        id,
        USER
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_parent_fk_rejects_missing_channels_and_cascades(pool: PgPool) {
    setup(&pool).await;
    let channel = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mut post = command("message-doc-a", None, "channel root");
    post.parent = MessageParent::Channel(channel);
    post.input.attachments.push(NewAttachment {
        entity_type: "document".into(),
        entity_id: "message-doc-a".into(),
        width: None,
        height: None,
    });
    let root = repo.create(post.clone()).await.unwrap();
    post.input.thread_id = Some(root.id);
    let reply = repo.create(post.clone()).await.unwrap();
    let document = repo
        .create(command("message-doc-a", None, "keep"))
        .await
        .unwrap();
    sqlx::query!("DELETE FROM comms_channels WHERE id = $1", channel)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM comms_messages WHERE id = ANY($1)",
            &[root.id, reply.id]
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM comms_message_threads WHERE root_id = $1",
            root.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM comms_attachments WHERE message_id = ANY($1)",
            &[root.id, reply.id]
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    assert!(
        repo.get(&document.parent, document.id)
            .await
            .unwrap()
            .is_some()
    );
    post.input.thread_id = None;
    assert!(repo.create(post).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soft_delete_cleans_only_matching_parent_message_notifications(pool: PgPool) {
    setup(&pool).await;
    let channel = channel(&pool).await;
    let team = macro_uuid::generate_uuid_v7();
    let company = macro_uuid::generate_uuid_v7();
    let contact = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO team(id, name, owner_id) VALUES ($1, 'test', $2)",
        team,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO crm_companies(id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", company, team)
        .execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO crm_contacts(id, company_id, email, first_interaction, last_interaction) VALUES ($1, $2, 'contact@example.com', now(), now())", contact, company)
        .execute(&pool).await.unwrap();

    for (parent_type, parent_id, key) in [
        ("channel", channel.to_string(), "messageId"),
        ("channel", channel.to_string(), "message_id"),
        ("document", "message-doc-a".to_owned(), "commentId"),
        (
            "initiative",
            macro_uuid::generate_uuid_v7().to_string(),
            "messageId",
        ),
        ("crm_company", company.to_string(), "messageId"),
        ("crm_contact", contact.to_string(), "messageId"),
    ] {
        let message = macro_uuid::generate_uuid_v7();
        sqlx::query!("INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content) VALUES ($1, $2, $3, $4, 'test')", message, parent_type, parent_id, USER)
            .execute(&pool).await.unwrap();
        let matching = macro_uuid::generate_uuid_v7();
        let mut keep = Vec::new();
        for (id, kind, parent, metadata) in [
            (
                matching,
                parent_type,
                parent_id.clone(),
                serde_json::json!({key: message}),
            ),
            (
                macro_uuid::generate_uuid_v7(),
                parent_type,
                "different-parent".into(),
                serde_json::json!({key: message}),
            ),
            (
                macro_uuid::generate_uuid_v7(),
                "different-type",
                parent_id.clone(),
                serde_json::json!({key: message}),
            ),
            (
                macro_uuid::generate_uuid_v7(),
                parent_type,
                parent_id.clone(),
                serde_json::json!({key: macro_uuid::generate_uuid_v7()}),
            ),
            (
                macro_uuid::generate_uuid_v7(),
                parent_type,
                parent_id.clone(),
                serde_json::json!({"threadId": message}),
            ),
            (
                macro_uuid::generate_uuid_v7(),
                parent_type,
                parent_id.clone(),
                serde_json::json!({"commentId": 42}),
            ),
        ] {
            sqlx::query!("INSERT INTO notification(id, notification_event_type, event_item_type, event_item_id, service_sender, metadata) VALUES ($1, 'test', $2, $3, 'test', $4)", id, kind, parent, metadata)
                .execute(&pool).await.unwrap();
            sqlx::query!(
                "INSERT INTO user_notification(user_id, notification_id) VALUES ($1, $2)",
                USER,
                id
            )
            .execute(&pool)
            .await
            .unwrap();
            if id != matching {
                keep.push(id);
            }
        }
        // Ordinary edits must not delete notifications.
        sqlx::query!(
            "UPDATE comms_messages SET deleted_at = NULL, content = 'edited' WHERE id = $1",
            message
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM notification WHERE id = $1", matching)
                .fetch_one(&pool)
                .await
                .unwrap(),
            Some(1)
        );
        sqlx::query!(
            "UPDATE comms_messages SET deleted_at = now() WHERE id = $1",
            message
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM notification WHERE id = $1", matching)
                .fetch_one(&pool)
                .await
                .unwrap(),
            Some(0)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM user_notification WHERE notification_id = $1",
                matching
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(0)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM notification WHERE id = ANY($1)",
                &keep
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            Some(keep.len() as i64)
        );
    }
}
