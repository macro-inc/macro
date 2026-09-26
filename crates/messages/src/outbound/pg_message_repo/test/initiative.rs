use super::*;
use crate::domain::service::{MessageService, MessageView, MessageWrite};
use ::initiative::domain::lookup::InitiativeLookup;
use ::initiative::outbound::PgInitiativeRepo;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};

async fn create_project(pool: &PgPool, id: Uuid, document: &str) {
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "createdAt", "updatedAt") VALUES ($1, NOW(), NOW())"#,
        id.to_string()
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(r#"INSERT INTO initiative (id, name, owner_user_id, share_permission_id, description_document_id)
        VALUES ($1, 'Project discussion', $2, $3, $4)"#, id, USER, id.to_string(), document).execute(pool).await.unwrap();
}

fn receipt<P: RequiredPermission>(id: Uuid) -> EntityAccessReceipt<P> {
    EntityAccessReceipt::try_new_authenticated_user(
        USER.to_owned().try_into().unwrap(),
        Entity {
            entity_type: EntityType::Initiative,
            entity_id: id.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

fn input(content: &str, root: Option<Uuid>) -> PostMessage {
    command("unused", root, content).input
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn project_discussion_lifecycle_cascades_on_parent_deletion(pool: PgPool) {
    setup(&pool).await;
    let id = macro_uuid::generate_uuid_v7();
    create_project(&pool, id, "message-doc-a").await;
    let repo = PgMessageRepository::new(pool.clone())
        .with_initiatives(InitiativeLookup::new(PgInitiativeRepo::new(pool.clone())));
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let root = service
        .post(receipt::<MessageWrite>(id), input("Project comment", None))
        .await
        .unwrap();
    let mut reply_input = input("Threaded reply", Some(root.id));
    reply_input.mentions.push(SimpleMention {
        entity_type: "user".into(),
        entity_id: USER.into(),
    });
    reply_input.attachments.push(NewAttachment {
        entity_type: "static_image".into(),
        entity_id: macro_uuid::generate_uuid_v7().to_string(),
        width: None,
        height: None,
    });
    let reply = service.post(receipt(id), reply_input).await.unwrap();
    assert_eq!(reply.mentions.len(), 1);
    assert_eq!(reply.attachments.len(), 1);
    let reacted = service
        .react(receipt(id), root.id, "👍".into(), true, None)
        .await
        .unwrap();
    assert_eq!(reacted.reactions[0].users, vec![USER]);
    let state = service
        .patch_thread(
            receipt(id),
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(state.resolved);
    let edited = service
        .patch(
            receipt(id),
            reply.id,
            MessagePatch {
                content: Some("Edited reply".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.content, "Edited reply");
    let history = service
        .preceding(receipt::<MessageView>(id), reply.id, 20)
        .await
        .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, root.id);
    let page = service
        .timeline(receipt(id), MessageTimelineQuery::default())
        .await
        .unwrap();
    assert_eq!(page.items[0].thread.reply_count, 1);
    // Project roots use the same teardown policy as document discussions:
    // deleting the root hides the whole thread, including its replies.
    let deleted = service.delete(receipt(id), root.id, None).await.unwrap();
    assert!(deleted.deleted_at.is_some());
    assert!(deleted.content.is_empty());
    assert!(matches!(
        service.get_thread(receipt(id), root.id).await,
        Err(MessageError::NotFound)
    ));
    let parent = MessageParent::Initiative(id);
    assert!(
        repo.thread(&parent, root.id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
    assert!(
        repo.get(&parent, reply.id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
    assert!(repo.replies(&parent, root.id).await.unwrap().is_empty());
    sqlx::query!("DELETE FROM initiative WHERE id = $1", id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service.get_thread(receipt(id), root.id).await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service.post(receipt(id), input("too late", None)).await,
        Err(MessageError::NotFound)
    ));
    assert!(
        repo.get(&MessageParent::Initiative(id), reply.id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repo.thread(&MessageParent::Initiative(id), root.id)
            .await
            .unwrap()
            .is_none()
    );
    // Even a direct repository caller with a stale identity cannot bypass the FK.
    let residual = sqlx::query!(r#"SELECT
        EXISTS(SELECT 1 FROM comms_attachments WHERE message_id = ANY($1)) AS "attachments!",
        EXISTS(SELECT 1 FROM comms_reactions WHERE message_id = ANY($1)) AS "reactions!",
        EXISTS(SELECT 1 FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = ANY($2)) AS "mentions!""#,
        &[root.id, reply.id], &[root.id.to_string(), reply.id.to_string()]).fetch_one(&pool).await.unwrap();
    assert!(!residual.attachments && !residual.reactions && !residual.mentions);
    let mut late = command("unused", None, "race");
    late.parent = MessageParent::Initiative(id);
    assert!(matches!(
        repo.create(late).await,
        Err(MessageError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initiative_threads_reject_cross_parent_replies_and_thread_deletion_hides_messages(
    pool: PgPool,
) {
    setup(&pool).await;
    let first = macro_uuid::generate_uuid_v7();
    let second = macro_uuid::generate_uuid_v7();
    create_project(&pool, first, "message-doc-a").await;
    create_project(&pool, second, "message-doc-b").await;
    let repo = PgMessageRepository::new(pool.clone())
        .with_initiatives(InitiativeLookup::new(PgInitiativeRepo::new(pool)));
    let service = MessageService::new(repo, NoMessageEventPublisher);
    let root = service
        .post(receipt(first), input("Project one", None))
        .await
        .unwrap();
    assert!(matches!(
        service
            .post(receipt(second), input("Wrong project", Some(root.id)))
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service.get(receipt::<MessageView>(second), root.id).await,
        Err(MessageError::NotFound)
    ));
    service
        .delete_thread(receipt(first), root.id, None)
        .await
        .unwrap();
    assert!(
        service
            .timeline(receipt(first), MessageTimelineQuery::default())
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert!(matches!(
        service
            .post(receipt(first), input("Deleted discussion", Some(root.id)))
            .await,
        Err(MessageError::NotFound)
    ));
}
