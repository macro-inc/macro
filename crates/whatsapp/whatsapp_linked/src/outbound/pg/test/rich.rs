use super::*;
use external_chat::domain::rich::{
    Location, Poll, PollOption, PollVote, RichContent, SystemAction, SystemLine,
};
use external_chat::domain::timeline::{
    ExternalChatMessageKind, ExternalChatPersonRef, ExternalChatPollOption, ExternalChatRichContent,
};

fn with(
    mut event: InboundEvent,
    kind: MessageKind,
    rich: Option<RichContent>,
    target: Option<Target>,
) -> InboundEvent {
    if let InboundKind::Message(message) = &mut event.kind {
        message.kind = kind;
        message.rich = rich;
        message.target = target;
    }
    event
}

fn person(name: &str, user: Option<&str>) -> ExternalChatPersonRef {
    ExternalChatPersonRef {
        name: name.to_owned(),
        user_id: user.map(str::to_owned),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_system_line_names_people_and_never_notifies_or_counts_as_unread(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let added = with(
        text(30, CUSTOMER_JID, "SYSTEM-ADD", ""),
        MessageKind::System,
        Some(RichContent::System(SystemLine {
            action: SystemAction::ParticipantsAdded,
            participants: vec![BOB_JID.to_owned()],
            value: None,
            call: None,
            by_whatsapp: false,
        })),
        None,
    );

    session.ingest_event(alice, &added).await.unwrap();

    let messages = linked
        .chats
        .messages(&receipt::<MessageView>(BOB, binding.id), None, Some(50))
        .await
        .unwrap()
        .messages;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].kind, ExternalChatMessageKind::System);
    let Some(ExternalChatRichContent::System(line)) = &messages[0].rich else {
        panic!("expected a system line");
    };
    assert_eq!(line.action, SystemAction::ParticipantsAdded);
    assert_eq!(line.actor, Some(person("Customer", None)));
    assert_eq!(line.participants, vec![person("+15550000002", None)]);
    assert_eq!(
        linked
            .store
            .chat_facts(binding.id, BOB)
            .await
            .unwrap()
            .unread_count,
        0
    );
    let effects = linked.store.pending_effects(10).await.unwrap();
    assert_eq!(effects.len(), 1);
    assert!(effects[0].system);
    assert!(!effects[0].should_notify());
}

fn lunch() -> RichContent {
    RichContent::Poll(Poll {
        question: "Lunch?".to_owned(),
        options: vec![
            PollOption {
                name: "Pizza".to_owned(),
                hash: "aa".to_owned(),
            },
            PollOption {
                name: "Sushi".to_owned(),
                hash: "bb".to_owned(),
            },
        ],
        selectable_count: 1,
    })
}

fn vote(event: u128, voter: &str, source: &str, revision: i64, selected: &[&str]) -> InboundEvent {
    let mut event = with(
        text(event, voter, source, ""),
        MessageKind::PollVote,
        Some(RichContent::PollVote(PollVote {
            selected: selected.iter().map(|hash| (*hash).to_owned()).collect(),
        })),
        Some(Target {
            source_id: "POLL".to_owned(),
            sender_jid: CUSTOMER_JID.to_owned(),
        }),
    );
    if let InboundKind::Message(message) = &mut event.kind {
        message.revision = revision;
        message.sender.display_name = None;
    }
    event
}

async fn tallies(linked: &Linked, group: Uuid) -> Vec<ExternalChatPollOption> {
    let messages = linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, group), None, Some(50))
        .await
        .unwrap()
        .messages;
    let Some(ExternalChatRichContent::Poll(poll)) = &messages[0].rich else {
        panic!("expected a poll");
    };
    poll.options.clone()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn poll_votes_tally_per_voter_and_the_latest_vote_wins(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    // A vote that arrives before its poll waits for it.
    assert_eq!(
        session
            .ingest_event(alice, &vote(41, ALICE_JID, "VOTE-1", 1_000, &["aa"]))
            .await
            .unwrap(),
        IngestOutcome::Deferred
    );
    session
        .ingest_event(
            alice,
            &with(
                text(40, CUSTOMER_JID, "POLL", ""),
                MessageKind::Rich,
                Some(lunch()),
                None,
            ),
        )
        .await
        .unwrap();
    session
        .ingest_event(alice, &vote(41, ALICE_JID, "VOTE-1", 1_000, &["aa"]))
        .await
        .unwrap();
    session
        .ingest_event(alice, &vote(42, CUSTOMER_JID, "VOTE-2", 1_000, &["aa"]))
        .await
        .unwrap();

    let options = tallies(&linked, binding.id).await;
    assert_eq!(options[0].votes, 2);
    assert!(options[0].mine, "Alice's own number voted");
    assert_eq!(options[1].votes, 0);

    // The customer changes their mind; a late copy of the old vote is ignored.
    session
        .ingest_event(alice, &vote(43, CUSTOMER_JID, "VOTE-3", 2_000, &["bb"]))
        .await
        .unwrap();
    session
        .ingest_event(alice, &vote(44, CUSTOMER_JID, "VOTE-2", 1_000, &["aa"]))
        .await
        .unwrap();

    let options = tallies(&linked, binding.id).await;
    assert_eq!(options[0].votes, 1);
    assert_eq!(options[1].votes, 1);
    assert_eq!(options[1].voters, vec![person("Customer", None)]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_re_imported_placeholder_gains_its_content_and_mentions_read_as_names(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut placeholder = text(
        50,
        CUSTOMER_JID,
        "PLACE",
        "Sent something Macro can't show yet",
    );
    if let InboundKind::Message(message) = &mut placeholder.kind {
        message.kind = MessageKind::Unsupported;
    }
    session.ingest_event(alice, &placeholder).await.unwrap();
    let mut location = with(
        text(51, CUSTOMER_JID, "PLACE", ""),
        MessageKind::Rich,
        Some(RichContent::Location(Location {
            latitude: 40.7,
            longitude: -74.0,
            name: Some("Office".to_owned()),
            address: None,
            url: None,
            live: false,
            comment: None,
        })),
        None,
    );
    if let InboundKind::Message(message) = &mut location.kind {
        message.history = true;
    }
    let mut mention = text(52, ALICE_JID, "MENTION", "ping @15558880001");
    if let InboundKind::Message(message) = &mut mention.kind {
        message.mentions = vec![CUSTOMER_JID.to_owned()];
        message.forwarded = true;
    }

    session.ingest_event(alice, &location).await.unwrap();
    session.ingest_event(alice, &mention).await.unwrap();

    let messages = linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, binding.id), None, Some(50))
        .await
        .unwrap()
        .messages;
    let place = messages.iter().find(|m| m.body.is_empty()).unwrap();
    let Some(ExternalChatRichContent::Location(location)) = &place.rich else {
        panic!("the placeholder became the location");
    };
    assert_eq!(location.name.as_deref(), Some("Office"));
    let ping = messages
        .iter()
        .find(|m| m.body == "ping @15558880001")
        .unwrap();
    assert!(ping.forwarded);
    assert_eq!(ping.mentions.len(), 1);
    assert_eq!(ping.mentions[0].token, "15558880001");
    assert_eq!(ping.mentions[0].person, person("Customer", None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_change_whatsapp_made_without_naming_anyone_is_the_groups_own_line(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut renamed = with(
        text(60, GROUP, "SYSTEM-RENAME", ""),
        MessageKind::System,
        Some(RichContent::System(SystemLine {
            action: SystemAction::SubjectChanged,
            participants: vec![],
            value: Some("Launch".to_owned()),
            call: None,
            by_whatsapp: true,
        })),
        None,
    );
    if let InboundKind::Message(message) = &mut renamed.kind {
        message.sender.display_name = None;
    }

    assert_eq!(
        session.ingest_event(alice, &renamed).await.unwrap(),
        IngestOutcome::Applied
    );
    session.ingest_event(alice, &renamed).await.unwrap();

    let messages = linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, binding.id), None, Some(50))
        .await
        .unwrap()
        .messages;
    assert_eq!(messages.len(), 1, "redelivery converges on one line");
    let Some(ExternalChatRichContent::System(line)) = &messages[0].rich else {
        panic!("expected a system line");
    };
    assert_eq!(line.actor, None);
    assert_eq!(line.value.as_deref(), Some("Launch"));
}
