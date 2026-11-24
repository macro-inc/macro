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
        .unwrap()
        .message;
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
        .unwrap()
        .message;
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
        .unwrap()
        .message;
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

#[tokio::test]
async fn a_repeated_delete_of_someone_elses_message_is_still_forbidden() {
    let mut repo = fixture();
    repo.message.deleted_at = Some(Utc::now());
    repo.message.content = String::new();
    let service = MessageService::new(repo.clone(), Events::default());
    assert!(matches!(
        service
            .delete_once(
                access("macro|other@example.com", "doc", AccessLevel::Comment),
                repo.message.id,
                None,
            )
            .await,
        Err(MessageError::Forbidden),
    ));
}

#[tokio::test]
async fn a_repeated_edit_the_message_already_shows_writes_and_publishes_nothing() {
    let mut repo = fixture();
    repo.message.content = "Edited".into();
    repo.message.attachments = vec![MessageAttachment {
        id: Uuid::from_u128(602),
        entity_type: "document".into(),
        entity_id: "kept".into(),
        width: None,
        height: None,
        created_at: Utc::now(),
    }];
    let events = Events::default();
    let service =
        MessageService::new(repo.clone(), events.clone()).with_references(ReferenceAccess {
            allowed: true,
            checked: Arc::default(),
        });
    let edit = || MessagePatch {
        content: Some("Edited".into()),
        attachments: AttachmentChange::DeltaOnce {
            remove: vec![Uuid::from_u128(601)],
            add: vec![NewAttachment {
                entity_type: "document".into(),
                entity_id: "kept".into(),
                width: None,
                height: None,
            }],
        },
        ..Default::default()
    };
    let message = service
        .patch_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            edit(),
        )
        .await
        .unwrap()
        .message;
    assert_eq!(message.content, "Edited");
    assert!(repo.edits.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());

    // A plain patch keeps writing an identical edit, as REST always has.
    service
        .patch(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            edit(),
        )
        .await
        .unwrap();
    assert_eq!(repo.edits.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_replayed_edit_that_changes_something_is_written() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    service
        .patch_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            MessagePatch {
                content: Some("Changed".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(repo.edits.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

const CHANNEL: MessageParent = MessageParent::Channel(Uuid::from_u128(20));

/// A channel whose counter stands at 41 and whose next write commits 42.
fn in_channel(repo: Repo) -> Repo {
    let mut repo = repo;
    repo.message.parent = CHANNEL;
    repo.mutation_seq = Some(42);
    repo.change_log.seq = 41;
    repo
}

#[tokio::test]
async fn a_write_answers_with_the_position_it_committed() {
    let repo = in_channel(fixture());
    let service = MessageService::new(repo.clone(), Events::default());
    let id = repo.message.id;
    let mut input = post_input();
    input.id = Some(Uuid::now_v7());
    let patch = MessagePatch {
        content: Some("Changed".into()),
        ..Default::default()
    };
    let written = [
        service.post_once(channel_access(), input).await,
        service.patch_once(channel_access(), id, patch).await,
        service
            .react_once(channel_access(), id, "👍".into(), true, None)
            .await,
        service.delete_once(channel_access(), id, None).await,
    ];
    assert_eq!(written.map(|written| written.unwrap().seq), [Some(42); 4]);
    // A first write never reads the counter: by then it may be past the write.
    assert!(!repo.reads.lock().unwrap().contains(&"seq"));
}

#[tokio::test]
async fn a_replay_answers_with_the_channels_position_read_before_its_message() {
    let id = Uuid::now_v7();
    let mut repo = in_channel(persisted(id));
    repo.reaction_changed = false;
    repo.message.content = "Shown".into();

    let service = MessageService::new(repo.clone(), Events::default());
    let mut input = post_input();
    input.id = Some(id);
    let patch = MessagePatch {
        content: Some("Shown".into()),
        ..Default::default()
    };
    let last_reads = || {
        let reads = std::mem::take(&mut *repo.reads.lock().unwrap());
        reads[reads.len() - 2..].to_vec()
    };

    let posted = service.post_once(channel_access(), input.clone()).await;
    assert_eq!(posted.unwrap().seq, Some(41));
    assert_eq!(last_reads(), ["seq", "message"]);

    let edited = service.patch_once(channel_access(), id, patch).await;
    assert_eq!(edited.unwrap().seq, Some(41));
    assert_eq!(last_reads(), ["seq", "message"]);

    let reacted = service.react_once(channel_access(), id, "👍".into(), true, None);
    assert_eq!(reacted.await.unwrap().seq, Some(41));
    assert_eq!(last_reads(), ["seq", "message"]);

    // A post that loses the race to its own replay.
    let mut raced = repo.clone();
    raced.concurrent_create = true;
    let service = MessageService::new(raced, Events::default());
    let recovered = service.post_once(channel_access(), input).await.unwrap();
    assert_eq!((recovered.message.id, recovered.seq), (id, Some(41)));
    assert_eq!(last_reads(), ["seq", "message"]);

    // A delete of a message already gone.
    let mut gone = repo.clone();
    gone.message.deleted_at = Some(Utc::now());
    let service = MessageService::new(gone, Events::default());
    let deleted = service.delete_once(channel_access(), id, None).await;
    assert_eq!(deleted.unwrap().seq, Some(41));
    assert_eq!(last_reads(), ["seq", "message"]);
}

#[tokio::test]
async fn a_write_outside_a_channel_has_no_position() {
    let id = Uuid::now_v7();
    let repo = persisted(id);
    let service = MessageService::new(repo.clone(), Events::default());
    let mut input = post_input();
    input.id = Some(id);
    let replayed = service
        .post_once(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert_eq!(replayed.seq, None);
    assert!(!repo.reads.lock().unwrap().contains(&"seq"));
}
