use super::*;

fn persisted_call_message() -> (Repo, Uuid, PostMessage) {
    let mut repo = fixture();
    let call_id = macro_uuid::generate_uuid_v7();
    repo.message.id = call_id;
    repo.message.parent = MessageParent::Call(call_id);
    repo.state.root_id = call_id;
    repo.client_message_id = Some(macro_uuid::generate_uuid_v7());
    let mut input = post_input();
    input.id = repo.client_message_id;
    (repo, call_id, input)
}

#[tokio::test]
async fn call_root_retry_returns_the_canonical_message_without_delivery() {
    let (mut repo, call_id, input) = persisted_call_message();
    repo.message.content = "Edited since the original send".into();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post(
            call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.id, call_id);
    assert_eq!(message.content, "Edited since the original send");
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn call_reply_retry_returns_the_existing_reply_without_delivery() {
    let (mut repo, call_id, mut input) = persisted_call_message();
    repo.message.id = input.id.unwrap();
    repo.message.thread_id = Some(call_id);
    input.thread_id = Some(call_id);
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post(
            call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.id, repo.message.id);
    assert_eq!(message.thread_id, Some(call_id));
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn call_retry_recovers_a_concurrent_commit_without_delivery() {
    let (mut repo, call_id, input) = persisted_call_message();
    repo.concurrent_create = true;
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post(
            call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.id, call_id);
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn call_retry_does_not_restore_a_deleted_message() {
    let (mut repo, call_id, input) = persisted_call_message();
    repo.message.deleted_at = Some(Utc::now());
    repo.message.content.clear();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .post(
            call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
            input,
        )
        .await
        .unwrap();
    assert!(message.deleted_at.is_some());
    assert!(message.content.is_empty());
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn call_retry_cannot_recover_another_actor_or_parents_message() {
    let (repo, call_id, input) = persisted_call_message();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    for (actor, parent) in [
        ("macro|other@example.com", call_id),
        ("macro|author@example.com", macro_uuid::generate_uuid_v7()),
    ] {
        assert!(matches!(
            service
                .post(
                    call_receipt(actor, parent, AccessLevel::Comment).unwrap(),
                    input.clone(),
                )
                .await,
            Err(MessageError::Conflict),
        ));
    }
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn call_retry_still_rejects_a_deleted_parent() {
    let (repo, call_id, input) = persisted_call_message();
    let events = Events::default();
    let service = MessageService::new(
        StrictRepo {
            inner: repo.clone(),
            parent_exists: false,
        },
        events.clone(),
    );
    assert!(matches!(
        service
            .post(
                call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
                input,
            )
            .await,
        Err(MessageError::NotFound),
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}
