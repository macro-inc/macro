use super::*;

const CHANNEL: Uuid = Uuid::from_u128(0xc0);
const CALLER: &str = "macro|caller@example.com";

fn channel_access(user: &str) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(user.to_owned().try_into().unwrap()),
        entity_access::domain::models::Entity {
            entity_id: CHANNEL.to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

/// A channel call whose root has been posted.
fn posted_root() -> (Repo, Uuid) {
    let call_id = macro_uuid::generate_uuid_v7();
    let mut repo = fixture();
    repo.message.id = call_id;
    repo.message.parent = MessageParent::Channel(CHANNEL);
    repo.message.kind = MessageKind::CallRoot;
    repo.message.sender_id = ChannelSender::try_from(CALLER.to_owned()).unwrap();
    repo.state.root_id = call_id;
    repo.state.anchor = None;
    repo.call_thread = Some(CallThreadFacts {
        channel_id: CHANNEL,
        created_by: CALLER.into(),
    });
    (repo, call_id)
}

#[tokio::test]
async fn a_call_root_is_created_from_the_calls_record_and_announced_only_as_itself() {
    let (mut repo, call_id) = posted_root();
    // No root exists yet; this repo's message stands for a different id.
    repo.message.id = Uuid::from_u128(9);
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());

    service.ensure_call_root(call_id).await.unwrap();

    let creates = repo.creates.lock().unwrap();
    assert_eq!(creates.len(), 1);
    assert_eq!(creates[0].kind, MessageKind::CallRoot);
    assert_eq!(creates[0].input.id, Some(call_id));
    assert_eq!(creates[0].parent, MessageParent::Channel(CHANNEL));
    assert_eq!(creates[0].actor.as_ref(), CALLER);
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert!(matches!(
        events[0].change,
        MessageChange::CallRootPosted { .. }
    ));
    assert!(events[0].agent_trigger().is_none());
}

#[tokio::test]
async fn asking_for_an_existing_root_again_creates_and_announces_nothing() {
    let (repo, call_id) = posted_root();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());

    let root = service.ensure_call_root(call_id).await.unwrap();

    assert_eq!(root.id, call_id);
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_call_without_a_channel_thread_has_no_root_to_create() {
    let (mut repo, call_id) = posted_root();
    repo.call_thread = None;
    let service = MessageService::new(repo.clone(), Events::default());

    assert!(matches!(
        service.ensure_call_root(call_id).await,
        Err(MessageError::NotFound)
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn nobody_can_change_a_call_root_including_its_sender_and_a_channel_owner() {
    let (repo, call_id) = posted_root();
    let service = MessageService::new(repo, Events::default());

    for user in [CALLER, "macro|owner@example.com"] {
        assert!(matches!(
            service
                .patch(
                    channel_access(user),
                    call_id,
                    MessagePatch {
                        content: Some("edited".into()),
                        ..Default::default()
                    }
                )
                .await,
            Err(MessageError::Forbidden)
        ));
        assert!(matches!(
            service.delete(channel_access(user), call_id, None).await,
            Err(MessageError::Forbidden)
        ));
        assert!(matches!(
            service
                .react(channel_access(user), call_id, "👍".into(), true, None)
                .await,
            Err(MessageError::Forbidden)
        ));
    }
}

#[tokio::test]
async fn a_stale_client_cannot_post_to_the_call_parent_of_a_channel_thread_call() {
    let (mut repo, call_id) = posted_root();
    repo.message.parent = MessageParent::Call(call_id);
    let service = MessageService::new(repo.clone(), Events::default());

    let result = service
        .post(
            call_receipt("macro|member@example.com", call_id, AccessLevel::Comment).unwrap(),
            post_input(),
        )
        .await;

    assert!(matches!(result, Err(MessageError::Invalid(_))));
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_call_root_page_entry_carries_the_calls_life_and_a_deleted_record_reads_as_such() {
    let (mut repo, call_id) = posted_root();
    let ended_call = macro_uuid::generate_uuid_v7();
    let ended_at = Utc::now();
    repo.call_statuses.insert(
        ended_call,
        CallEntryStatus::Ended {
            ended_at,
            duration_ms: 1_000,
        },
    );
    let service = MessageService::new(repo.clone(), Events::default());
    let item = |id| MessageListItem {
        message: Message {
            id,
            ..repo.message.clone()
        },
        state: repo.state.clone(),
        thread: MessageThreadPreview {
            reply_count: 0,
            latest_reply_at: None,
            preview: vec![],
        },
    };
    let plain = MessageListItem {
        message: Message {
            kind: MessageKind::Message,
            ..item(Uuid::from_u128(5)).message
        },
        ..item(Uuid::from_u128(5))
    };

    let page = service
        .with_call_entries(MessageTimelinePage {
            entries: vec![
                MessageTimelineEntry::Message {
                    message: Box::new(item(ended_call)),
                },
                MessageTimelineEntry::Message {
                    message: Box::new(item(call_id)),
                },
                MessageTimelineEntry::Message {
                    message: Box::new(plain),
                },
            ],
            next_cursor: None,
            previous_cursor: None,
        })
        .await
        .unwrap();

    assert!(matches!(
        page.entries[0],
        MessageTimelineEntry::Call {
            status: CallEntryStatus::Ended {
                duration_ms: 1_000,
                ..
            },
            ..
        }
    ));
    assert!(matches!(
        page.entries[1],
        MessageTimelineEntry::Call {
            status: CallEntryStatus::RecordDeleted,
            ..
        }
    ));
    assert!(matches!(
        page.entries[2],
        MessageTimelineEntry::Message { .. }
    ));
}
