use super::*;

fn event_id() -> Uuid {
    let created = Utc::now() - chrono::TimeDelta::days(30);
    Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        created.timestamp() as u64,
        created.timestamp_subsec_nanos(),
    ))
}

fn persisted_event() -> Repo {
    let mut repo = fixture();
    repo.message.id = event_id();
    repo.state.root_id = repo.message.id;
    repo
}

#[tokio::test]
async fn a_delayed_server_event_posts_but_a_client_with_the_same_old_id_is_rejected() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let id = event_id();
    let mut input = post_input();
    input.id = Some(id);
    assert!(matches!(
        service
            .post(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                input.clone()
            )
            .await,
        Err(MessageError::Invalid(_)),
    ));
    let message = service
        .post_from_event(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            id,
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.id, id);
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn replay_preserves_edited_content_and_does_not_publish_again() {
    let mut repo = persisted_event();
    repo.message.content = "Edited after the original event".to_owned();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post_from_event(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            post_input(),
        )
        .await
        .unwrap();
    assert_eq!(message.content, "Edited after the original event");
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn replay_returns_a_deleted_discussion_without_resurrecting_it() {
    let repo = persisted_event();
    repo.thread_deletes.lock().unwrap().push(repo.message.id);
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post_from_event(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            post_input(),
        )
        .await
        .unwrap();
    assert!(message.deleted_at.is_some());
    assert!(message.content.is_empty());
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn replay_cannot_reuse_another_author_parent_or_thread() {
    let repo = persisted_event();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    for (author, parent, thread_id) in [
        ("macro|other@example.com", "doc", None),
        ("macro|author@example.com", "other-doc", None),
        ("macro|author@example.com", "doc", Some(Uuid::now_v7())),
    ] {
        let mut input = post_input();
        input.thread_id = thread_id;
        assert!(matches!(
            service
                .post_from_event(
                    access(author, parent, AccessLevel::Comment),
                    repo.message.id,
                    input
                )
                .await,
            Err(MessageError::Conflict),
        ));
    }
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn concurrent_event_delivery_recovers_the_committed_message() {
    let mut repo = persisted_event();
    repo.concurrent_create = true;
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post_from_event(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            post_input(),
        )
        .await
        .unwrap();
    assert_eq!(message.id, repo.message.id);
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn trusted_event_posts_still_validate_ids_content_and_references() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let mut empty = post_input();
    empty.content.clear();
    let mut inaccessible = post_input();
    inaccessible.mentions = vec![SimpleMention {
        entity_type: "document".to_owned(),
        entity_id: "private-document".to_owned(),
    }];
    for (id, input) in [
        (Uuid::new_v4(), post_input()),
        (event_id(), empty),
        (event_id(), inaccessible),
    ] {
        assert!(
            service
                .post_from_event(
                    access("macro|author@example.com", "doc", AccessLevel::Comment),
                    id,
                    input,
                )
                .await
                .is_err()
        );
    }
    assert!(repo.creates.lock().unwrap().is_empty());
}
