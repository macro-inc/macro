use super::*;

fn project_access<P: RequiredPermission>(
    user: &str,
    id: Uuid,
    level: AccessLevel,
) -> EntityAccessReceipt<P> {
    EntityAccessReceipt::try_new_authenticated_user(
        user.to_owned().try_into().unwrap(),
        entity_access::domain::models::Entity {
            entity_type: EntityType::Initiative,
            entity_id: id.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}

fn project_repo(id: Uuid) -> Repo {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Initiative(id);
    repo.message.imported_author = None;
    repo.state.anchor = None;
    repo
}

#[tokio::test]
async fn initiative_messages_use_parent_capabilities_and_authorship() {
    let id = Uuid::from_u128(901);
    let repo = project_repo(id);
    let service = MessageService::new(repo.clone(), Events::default());
    let author = "macro|author@example.com";
    let other = "macro|other@example.com";
    let message = service
        .post(
            project_access(author, id, AccessLevel::Comment),
            post_input(),
        )
        .await
        .unwrap();
    assert_eq!(message.parent, MessageParent::Initiative(id));
    let reply = service
        .post(
            project_access(other, id, AccessLevel::Comment),
            PostMessage {
                thread_id: Some(message.id),
                ..post_input()
            },
        )
        .await
        .unwrap();
    assert_eq!(reply.thread_id, Some(message.id));
    assert!(
        service
            .get(
                project_access::<MessageView>(other, id, AccessLevel::View),
                message.id
            )
            .await
            .is_ok()
    );
    assert!(matches!(
        service
            .get(
                project_access::<MessageView>(other, Uuid::from_u128(902), AccessLevel::View),
                message.id
            )
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .patch(
                project_access(other, id, AccessLevel::Edit),
                message.id,
                MessagePatch {
                    content: Some("changed".into()),
                    ..Default::default()
                }
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(
        service
            .patch(
                project_access(author, id, AccessLevel::Comment),
                message.id,
                MessagePatch {
                    content: Some("updated".into()),
                    ..Default::default()
                }
            )
            .await
            .is_ok()
    );
    assert!(matches!(
        service
            .delete(
                project_access(other, id, AccessLevel::Comment),
                message.id,
                None
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(
        service
            .delete(
                project_access(other, id, AccessLevel::Owner),
                message.id,
                None
            )
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn initiative_discussions_resolve_but_never_accept_document_anchors() {
    let id = Uuid::from_u128(903);
    let repo = project_repo(id);
    let service = MessageService::new(repo.clone(), Events::default());
    let access = || project_access("macro|author@example.com", id, AccessLevel::Edit);
    for resolved in [true, false] {
        let state = service
            .patch_thread(
                access(),
                repo.state.root_id,
                ThreadPatch {
                    resolved: Some(resolved),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(state.resolved, resolved);
    }
    assert!(matches!(
        service
            .patch_thread(
                access(),
                repo.state.root_id,
                ThreadPatch {
                    detach_anchor: true,
                    ..Default::default()
                }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    for anchor in [
        NewThreadAnchor::Markdown {
            mark_id: Uuid::from_u128(1),
            marked_text: None,
        },
        NewThreadAnchor::PdfHighlight {
            anchor_id: Uuid::from_u128(2),
        },
        NewThreadAnchor::PdfPlaceable {
            anchor_id: Uuid::from_u128(3),
            page: 0,
            x_pct: 0.0,
            y_pct: 0.0,
            width_pct: 0.1,
            height_pct: 0.1,
        },
    ] {
        assert!(matches!(
            service
                .post(
                    access(),
                    PostMessage {
                        anchor: Some(anchor),
                        ..post_input()
                    }
                )
                .await,
            Err(MessageError::Invalid(_))
        ));
    }
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deleted_initiative_threads_reject_replies() {
    let id = Uuid::from_u128(904);
    let mut repo = project_repo(id);
    repo.state.deleted_at = Some(Utc::now());
    let root = repo.state.root_id;
    let service = MessageService::new(repo.clone(), Events::default());
    assert!(matches!(
        service
            .post(
                project_access("macro|author@example.com", id, AccessLevel::Comment),
                PostMessage {
                    thread_id: Some(root),
                    ..post_input()
                }
            )
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
}
