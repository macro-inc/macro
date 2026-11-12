use super::*;

fn persisted(id: Uuid) -> Repo {
    let mut repo = fixture();
    repo.message.id = id;
    repo.state.root_id = id;
    repo
}

#[tokio::test]
async fn a_first_post_writes_and_publishes_once() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let mut input = post_input();
    input.id = Some(Uuid::now_v7());
    service
        .post_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_repeated_post_returns_the_stored_message_without_writing_or_publishing() {
    // Minted long ago: the answer to the first attempt was lost and the device
    // only came back days later.
    let created = Utc::now() - chrono::TimeDelta::days(3);
    let id = Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        created.timestamp() as u64,
        created.timestamp_subsec_nanos(),
    ));
    let mut repo = persisted(id);
    repo.message.content = "Stored".to_owned();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let mut input = post_input();
    input.id = Some(id);
    let message = service
        .post_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.content, "Stored");
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_repeated_post_cannot_claim_another_author_parent_or_thread() {
    let id = Uuid::now_v7();
    let repo = persisted(id);
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    for (author, parent, thread_id) in [
        ("macro|other@example.com", "doc", None),
        ("macro|author@example.com", "other-doc", None),
        ("macro|author@example.com", "doc", Some(Uuid::now_v7())),
    ] {
        let mut input = post_input();
        input.id = Some(id);
        input.thread_id = thread_id;
        assert!(matches!(
            service
                .post_once(access(author, parent, AccessLevel::Comment), input)
                .await,
            Err(MessageError::Conflict),
        ));
    }
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_post_without_an_id_or_with_a_forged_one_is_rejected() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    assert!(matches!(
        service
            .post_once(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                post_input(),
            )
            .await,
        Err(MessageError::Invalid(_)),
    ));
    let created = Utc::now() - chrono::TimeDelta::days(31);
    let mut input = post_input();
    input.id = Some(Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        created.timestamp() as u64,
        created.timestamp_subsec_nanos(),
    )));
    assert!(matches!(
        service
            .post_once(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                input,
            )
            .await,
        Err(MessageError::Invalid(_)),
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_post_that_loses_the_race_recovers_the_committed_message() {
    let id = Uuid::now_v7();
    let mut repo = persisted(id);
    repo.concurrent_create = true;
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let mut input = post_input();
    input.id = Some(id);
    let message = service
        .post_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert_eq!(message.id, id);
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_repeated_delete_returns_the_tombstone_without_publishing() {
    let mut repo = fixture();
    repo.message.deleted_at = Some(Utc::now());
    repo.message.content = String::new();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let message = service
        .delete_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            None,
        )
        .await
        .unwrap();
    assert!(message.deleted_at.is_some());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deleting_a_message_that_never_existed_is_still_not_found() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    assert!(matches!(
        service
            .delete_once(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                Uuid::now_v7(),
                None,
            )
            .await,
        Err(MessageError::NotFound),
    ));
}

#[tokio::test]
async fn a_first_post_held_offline_for_days_is_still_written() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let created = Utc::now() - chrono::TimeDelta::days(3);
    let mut input = post_input();
    input.id = Some(Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        created.timestamp() as u64,
        created.timestamp_subsec_nanos(),
    )));
    service
        .post_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_post_minted_in_the_future_is_rejected() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default());
    let created = Utc::now() + chrono::TimeDelta::days(2);
    let mut input = post_input();
    input.id = Some(Uuid::new_v7(uuid::Timestamp::from_unix(
        uuid::NoContext,
        created.timestamp() as u64,
        created.timestamp_subsec_nanos(),
    )));
    assert!(matches!(
        service
            .post_once(
                access("macro|author@example.com", "doc", AccessLevel::Comment),
                input,
            )
            .await,
        Err(MessageError::Invalid(_)),
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_repeated_edit_does_not_attach_the_same_entity_twice() {
    // The first attempt already removed 601 and attached "new"; its answer
    // was lost and the client sends the same edit again.
    let mut repo = fixture();
    repo.message.attachments = [("602", 602), ("new", 603)]
        .map(|(entity_id, id)| MessageAttachment {
            id: Uuid::from_u128(id),
            entity_type: "document".into(),
            entity_id: entity_id.into(),
            width: None,
            height: None,
            created_at: Utc::now(),
        })
        .to_vec();
    let service =
        MessageService::new(repo.clone(), Events::default()).with_references(ReferenceAccess {
            allowed: true,
            checked: Arc::default(),
        });
    service
        .patch(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            MessagePatch {
                attachments: AttachmentChange::DeltaOnce {
                    remove: vec![Uuid::from_u128(601)],
                    add: vec![NewAttachment {
                        entity_type: "document".into(),
                        entity_id: "new".into(),
                        width: None,
                        height: None,
                    }],
                },
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let edits = repo.edits.lock().unwrap();
    assert_eq!(
        edits[0]
            .attachments
            .as_ref()
            .unwrap()
            .iter()
            .map(|a| a.entity_id.as_str())
            .collect::<Vec<_>>(),
        ["602", "new"]
    );
}
