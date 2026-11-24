//! Which channel events make people "interacted on Macro" contacts.

use super::*;

fn service(
    contacts: FakeContacts,
) -> ChannelSideEffectService<FakeContext, FakeRealtime, FakeNotifications, FakeContacts> {
    ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        FakeNotifications::default(),
        contacts,
    )
}

async fn recorded(event: ChannelEvent) -> Vec<Interactions> {
    let contacts = FakeContacts::default();
    service(contacts.clone()).handle(event).await;
    std::mem::take(&mut *contacts.interactions.lock().unwrap())
}

fn pairs(users: &[&str], peers: &[&str]) -> Vec<Interactions> {
    vec![Interactions {
        users: super::users(users),
        peers: super::users(peers),
    }]
}

fn metadata(channel_type: ChannelType) -> ChannelMetadata {
    ChannelMetadata {
        channel_type,
        channel_name: "Project".to_string(),
        named: channel_type != ChannelType::DirectMessage,
    }
}

fn participant(user_id: &str) -> ChannelParticipant {
    ChannelParticipant {
        channel_id: Uuid::nil(),
        user_id: user_id.to_string(),
        role: ParticipantRole::Member,
        joined_at: Utc::now(),
        left_at: None,
    }
}

fn posted(
    channel_type: ChannelType,
    sender: Sender,
    triggered_by: Option<&str>,
    participants: &[&str],
) -> ChannelEvent {
    let now = Utc::now();
    ChannelEvent::MessagePosted {
        channel_id: Uuid::nil(),
        metadata: metadata(channel_type),
        participants: participants.iter().map(|id| participant(id)).collect(),
        message: MutatedMessage {
            id: Uuid::now_v7(),
            channel_id: Uuid::nil(),
            thread_id: None,
            sender_id: sender,
            triggered_by: triggered_by.map(str::to_string),
            triggered_via: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentions: Vec::new(),
        has_attachments: false,
        notification_policy: PostMessageNotificationPolicy::Default,
        finalized_reply: false,
    }
}

const NON_DM_TYPES: [ChannelType; 3] =
    [ChannelType::Private, ChannelType::Public, ChannelType::Team];

#[tokio::test]
async fn creating_a_channel_pairs_everyone_in_it() {
    for channel_type in NON_DM_TYPES {
        let everyone = [
            "macro|a@example.com",
            "macro|b@example.com",
            "macro|c@example.com",
        ];
        let event = ChannelEvent::ChannelCreated {
            channel_id: Uuid::nil(),
            actor: Sender::new_from_user(user("a@example.com")),
            on_behalf_of: None,
            channel_type,
            channel_name: Some("Project".to_string()),
            participant_user_ids: users(&["a@example.com", "b@example.com", "c@example.com"]),
        };

        assert_eq!(
            recorded(event).await,
            vec![Interactions {
                users: everyone.iter().map(|id| macro_id(id)).collect(),
                peers: everyone.iter().map(|id| macro_id(id)).collect(),
            }],
            "{channel_type:?}"
        );
    }
}

fn macro_id(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).unwrap()
}

#[tokio::test]
async fn a_channel_an_agent_creates_for_a_person_counts() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_bot(BotId::new_from_uuid(Uuid::now_v7())),
        on_behalf_of: Some(user("a@example.com")),
        channel_type: ChannelType::Private,
        channel_name: Some("Project".to_string()),
        participant_user_ids: users(&["a@example.com", "b@example.com"]),
    };

    assert_eq!(
        recorded(event).await,
        pairs(
            &["a@example.com", "b@example.com"],
            &["a@example.com", "b@example.com"]
        )
    );
}

#[tokio::test]
async fn a_channel_with_one_person_pairs_nobody() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_user(user("a@example.com")),
        on_behalf_of: None,
        channel_type: ChannelType::Private,
        channel_name: Some("Notes".to_string()),
        participant_user_ids: users(&["a@example.com"]),
    };

    assert!(recorded(event).await.is_empty());
}

#[tokio::test]
async fn an_empty_dm_pairs_nobody_whoever_created_it() {
    // `get_or_create_dm` and `ensure_dms` (teammate and inbox DMs) both
    // announce a new DM this way, before anyone has written in it.
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_user(user("a@example.com")),
        on_behalf_of: None,
        channel_type: ChannelType::DirectMessage,
        channel_name: None,
        participant_user_ids: users(&["a@example.com", "b@example.com"]),
    };

    assert!(recorded(event).await.is_empty());
}

#[tokio::test]
async fn signing_up_writes_no_interactions_from_the_support_channel() {
    let new_user = "new@example.com";
    let support = [
        "support-a@example.com",
        "support-b@example.com",
        "support-c@example.com",
    ];
    let mut participants = vec![new_user];
    participants.extend(support);

    // `create_system_channel`, as the signup webhook calls it.
    let created = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        on_behalf_of: Some(user(new_user)),
        channel_type: ChannelType::Private,
        channel_name: Some("Macro Support x New".to_string()),
        participant_user_ids: users(&participants),
    };
    // The welcome a support person posts right after.
    let participant_ids: Vec<String> = participants
        .iter()
        .map(|email| format!("macro|{email}"))
        .collect();
    let welcome = posted(
        ChannelType::Private,
        Sender::new_from_user(user("support-a@example.com")),
        None,
        &participant_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
    );

    assert!(recorded(created).await.is_empty());
    assert!(recorded(welcome).await.is_empty());
}

#[tokio::test]
async fn adding_people_pairs_them_with_every_active_member() {
    for channel_type in NON_DM_TYPES {
        // Approving a request to join dispatches the same event, with the
        // approver as `invited_by`.
        let event = ChannelEvent::ParticipantsAdded {
            channel_id: Uuid::nil(),
            channel_type,
            active_participant_user_ids: users(&[
                "a@example.com",
                "b@example.com",
                "c@example.com",
            ]),
            invited_by: Sender::new_from_user(user("a@example.com")),
            recipient_user_ids: users(&["c@example.com"]),
            metadata: metadata(channel_type),
            message_content: None,
        };

        assert_eq!(
            recorded(event).await,
            pairs(
                &["c@example.com"],
                &["a@example.com", "b@example.com", "c@example.com"]
            ),
            "{channel_type:?}"
        );
    }
}

#[tokio::test]
async fn joining_pairs_the_joiner_with_every_active_member() {
    for channel_type in NON_DM_TYPES {
        let event = ChannelEvent::ParticipantJoined {
            channel_id: Uuid::nil(),
            channel_type,
            user_id: Sender::new_from_user(user("c@example.com")),
            active_participant_user_ids: users(&[
                "a@example.com",
                "b@example.com",
                "c@example.com",
            ]),
        };

        assert_eq!(
            recorded(event).await,
            pairs(
                &["c@example.com"],
                &["a@example.com", "b@example.com", "c@example.com"]
            ),
            "{channel_type:?}"
        );
    }
}

#[tokio::test]
async fn joining_an_empty_channel_pairs_nobody() {
    let event = ChannelEvent::ParticipantJoined {
        channel_id: Uuid::nil(),
        channel_type: ChannelType::Public,
        user_id: Sender::new_from_user(user("a@example.com")),
        active_participant_user_ids: users(&["a@example.com"]),
    };

    assert!(recorded(event).await.is_empty());
}

#[tokio::test]
async fn team_auto_join_pairs_the_new_members_without_notifying_anyone() {
    let contacts = FakeContacts::default();
    let notifications = FakeNotifications::default();
    let realtime = FakeRealtime::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        realtime.clone(),
        notifications.clone(),
        contacts.clone(),
    );
    let event = ChannelEvent::MembersAutoJoined {
        channel_id: Uuid::nil(),
        added_user_ids: users(&["c@example.com"]),
        active_participant_user_ids: users(&["a@example.com", "b@example.com", "c@example.com"]),
    };

    assert!(broker_events_for_event(&event).is_empty());
    service.handle(event).await;

    assert_eq!(
        *contacts.interactions.lock().unwrap(),
        pairs(
            &["c@example.com"],
            &["a@example.com", "b@example.com", "c@example.com"]
        )
    );
    assert!(contacts.users.lock().unwrap().is_empty());
    assert!(notifications.effects.lock().unwrap().is_empty());
    assert!(realtime.effects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_persons_dm_message_pairs_the_two_people() {
    let event = posted(
        ChannelType::DirectMessage,
        Sender::new_from_user(user("a@example.com")),
        None,
        &["macro|a@example.com", "macro|b@example.com"],
    );

    assert_eq!(
        recorded(event).await,
        pairs(&["a@example.com"], &["b@example.com"])
    );
}

#[tokio::test]
async fn dm_messages_from_bots_and_guests_pair_nobody() {
    let bot = Sender::new_from_bot(BotId::new_from_uuid(Uuid::now_v7()));
    let events = [
        // A bot post made for a person.
        posted(
            ChannelType::DirectMessage,
            bot,
            Some("macro|a@example.com"),
            &["macro|a@example.com", "macro|b@example.com"],
        ),
        posted(
            ChannelType::DirectMessage,
            Sender::new_from_guest(Uuid::now_v7()),
            None,
            &["macro|a@example.com", "macro|b@example.com"],
        ),
    ];

    for event in events {
        assert!(recorded(event).await.is_empty());
    }
}

#[tokio::test]
async fn a_message_in_a_dm_with_an_agent_pairs_nobody() {
    let bot = format!("bot|{}", Uuid::now_v7());
    let event = posted(
        ChannelType::DirectMessage,
        Sender::new_from_user(user("a@example.com")),
        None,
        &["macro|a@example.com", &bot],
    );

    assert!(recorded(event).await.is_empty());
}

#[tokio::test]
async fn messages_outside_dms_pair_nobody() {
    for channel_type in NON_DM_TYPES {
        let event = posted(
            channel_type,
            Sender::new_from_user(user("a@example.com")),
            None,
            &["macro|a@example.com", "macro|b@example.com"],
        );

        assert!(recorded(event).await.is_empty(), "{channel_type:?}");
    }
}
