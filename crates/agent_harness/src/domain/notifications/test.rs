use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::events::{
    InputReceivedMetadata, SessionDeletedMetadata, SessionIdentity, SessionMentionedMetadata,
    SessionOpenedMetadata, SessionSettledMetadata, ThreadOrigin, TurnStartedMetadata, TurnSummary,
    WaitingForInputMetadata,
};
use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;

const SESSION: Uuid = Uuid::from_u128(0xA);
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;

use super::*;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("a valid email")
}

fn owner() -> MacroUserIdStr<'static> {
    user("owner@macro.com")
}

fn identity() -> SessionIdentity {
    SessionIdentity {
        session_id: AgentSessionId::new_from_uuid(SESSION),
        session_name: "Fix the flaky test".to_owned(),
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xB07)),
        bot_name: "Macro Coder".to_owned(),
        owner_id: owner(),
        origin: Some(ThreadOrigin::new(
            messages::domain::models::MessageParent::Channel(Uuid::from_u128(1)),
            Uuid::from_u128(2),
            Uuid::from_u128(3),
        )),
        audience: vec![owner(), user("alice@macro.com"), user("bob@macro.com")],
    }
}

fn detached_identity() -> SessionIdentity {
    SessionIdentity {
        origin: None,
        ..identity()
    }
}

fn settled(identity: SessionIdentity, turn: u32) -> AgentSessionLifecycleEvent {
    AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
        identity,
        last_turn: Some(TurnSummary {
            turn: TurnId(turn),
            action_id: AgentActionId::mint(),
            actor: Some(user("alice@macro.com")),
            announcement_message_id: Some(Uuid::from_u128(4)),
            stop_reason: "end_turn".to_owned(),
            excerpt: Some("Done.".to_owned()),
        }),
    })
}

/// The plan for a coding agent's session - the shape every fact had before
/// kinds could differ.
fn coder(event: &AgentSessionLifecycleEvent) -> Vec<PlannedNotification> {
    plan(event, AgentKind::SandboxedCoder)
}

fn one_settled(actions: Vec<PlannedNotification>) -> Notify<AgentSessionSettledMetadata> {
    match actions.as_slice() {
        [PlannedNotification::Settled(notify)] => notify.clone(),
        other => panic!("expected one settled notification, got {other:#?}"),
    }
}

#[test]
fn settled_notifies_the_whole_audience_under_the_session() {
    let notify = one_settled(coder(&settled(identity(), 2)));

    assert_eq!(
        notify.entity,
        EntityType::AgentSession.with_entity_string(SESSION.to_string())
    );
    assert_eq!(notify.secondary_entity, None);
    assert_eq!(
        notify.recipients,
        vec![owner(), user("alice@macro.com"), user("bob@macro.com")]
    );
    assert_eq!(notify.metadata.turn, 2);
    assert_eq!(notify.metadata.excerpt.as_deref(), Some("Done."));
    assert_eq!(notify.metadata.session.bot_name, "Macro Coder");
    assert_eq!(
        notify.metadata.session.announcement_message_id,
        Some(Uuid::from_u128(4))
    );
    // The thread the chip lives in still rides along for surfaces that
    // want to offer it.
    assert_eq!(notify.metadata.session.thread_id, Some(Uuid::from_u128(2)));
}

#[test]
fn a_session_with_no_thread_files_the_same_way() {
    let notify = one_settled(coder(&settled(detached_identity(), 0)));

    assert_eq!(
        notify.entity,
        EntityType::AgentSession.with_entity_string(SESSION.to_string())
    );
    assert_eq!(notify.metadata.session.channel_id, None);
}

#[test]
fn the_owner_always_hears_settled_even_when_the_audience_is_empty() {
    // An event published before the audience field existed.
    let notify = one_settled(coder(&settled(
        SessionIdentity {
            audience: Vec::new(),
            ..identity()
        },
        0,
    )));

    assert_eq!(notify.recipients, vec![owner()]);
}

#[test]
fn settled_ids_are_stable_per_turn_and_distinct_across_turns() {
    let first = one_settled(coder(&settled(identity(), 1)));
    let again = one_settled(coder(&settled(identity(), 1)));
    let next = one_settled(coder(&settled(identity(), 2)));

    assert_eq!(
        first.notification_id, again.notification_id,
        "a redelivery is a no-op"
    );
    assert_ne!(first.notification_id, next.notification_id);
    assert_eq!(
        first.notification_id,
        settled_notification_id(SESSION, TurnId(1))
    );
}

/// A chat agent's announced turn already reached the thread as the patched
/// reply, which the message service notifies on as a post.
#[test]
fn a_chat_agents_announced_turn_settles_silently() {
    let actions = plan(&settled(identity(), 2), AgentKind::InMemory);

    assert!(actions.is_empty(), "{actions:#?}");
}

/// Only the announced turn is spoken for by its reply: a chat session driven
/// from the session view posted nothing, so its audience still hears settled.
#[test]
fn a_chat_agents_unannounced_turn_still_notifies() {
    let event = AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
        identity: identity(),
        last_turn: Some(TurnSummary {
            turn: TurnId(2),
            action_id: AgentActionId::mint(),
            actor: Some(user("alice@macro.com")),
            announcement_message_id: None,
            stop_reason: "end_turn".to_owned(),
            excerpt: Some("Done.".to_owned()),
        }),
    });

    let notify = one_settled(plan(&event, AgentKind::InMemory));
    assert_eq!(
        notify.recipients,
        vec![owner(), user("alice@macro.com"), user("bob@macro.com")]
    );
    assert_eq!(notify.metadata.session.announcement_message_id, None);
}

/// A coding agent's chip is a pointer, not news, so settled is the only
/// thing the thread hears - whichever coding runtime it was.
#[test]
fn every_coding_kinds_announced_turn_notifies_settled() {
    for kind in [
        AgentKind::SandboxedCoder,
        AgentKind::Cursor,
        AgentKind::CodexCloud,
        AgentKind::ClaudeCloud,
        AgentKind::External,
    ] {
        let notify = one_settled(plan(&settled(identity(), 2), kind));
        assert_eq!(
            notify.metadata.session.announcement_message_id,
            Some(Uuid::from_u128(4)),
            "{kind:?}"
        );
    }
}

#[test]
fn settled_without_a_turn_record_notifies_nobody() {
    let actions = coder(&AgentSessionLifecycleEvent::Settled(
        SessionSettledMetadata {
            identity: identity(),
            last_turn: None,
        },
    ));

    assert!(actions.is_empty());
}

#[test]
fn waiting_for_input_goes_to_the_audience() {
    let actions = coder(&AgentSessionLifecycleEvent::WaitingForInput(
        WaitingForInputMetadata {
            identity: identity(),
            turn: TurnId(3),
            action_id: AgentActionId::mint(),
            announcement_message_id: None,
            question: "Which approach?".to_owned(),
        },
    ));

    let [PlannedNotification::WaitingForInput(notify)] = actions.as_slice() else {
        panic!("expected one waiting notification, got {actions:#?}");
    };
    assert_eq!(
        notify.recipients,
        vec![owner(), user("alice@macro.com"), user("bob@macro.com")]
    );
    assert_eq!(notify.metadata.question, "Which approach?");
    assert_eq!(notify.metadata.turn, 3);
    assert_eq!(
        notify.notification_id,
        waiting_notification_id(SESSION, TurnId(3))
    );
}

fn waiting(announcement_message_id: Option<Uuid>) -> AgentSessionLifecycleEvent {
    AgentSessionLifecycleEvent::WaitingForInput(WaitingForInputMetadata {
        identity: identity(),
        turn: TurnId(3),
        action_id: AgentActionId::mint(),
        announcement_message_id,
        question: "Which approach?".to_owned(),
    })
}

/// The pending reply is patched to say the agent is waiting, and that
/// patch notifies the thread; a notification on top would be the same
/// news twice.
#[test]
fn a_chat_agents_announced_turn_waits_silently() {
    let actions = plan(&waiting(Some(Uuid::from_u128(4))), AgentKind::InMemory);

    assert!(actions.is_empty(), "{actions:#?}");
}

/// Only the announced turn has a reply to speak through: a chat session
/// asking from the session view still notifies its audience, and a coding
/// agent's chip says nothing about a question.
#[test]
fn every_other_waiting_turn_still_notifies() {
    for (kind, announced) in [
        (AgentKind::InMemory, None),
        (AgentKind::SandboxedCoder, Some(Uuid::from_u128(4))),
        (AgentKind::Cursor, Some(Uuid::from_u128(4))),
        (AgentKind::External, None),
    ] {
        let actions = plan(&waiting(announced), kind);
        assert!(
            matches!(
                actions.as_slice(),
                [PlannedNotification::WaitingForInput(_)]
            ),
            "{kind:?} announced={announced:?}: {actions:#?}"
        );
    }
}

#[test]
fn mentioned_notifies_exactly_the_people_named() {
    let action_id = AgentActionId::mint();
    let actions = coder(&AgentSessionLifecycleEvent::Mentioned(
        SessionMentionedMetadata {
            identity: identity(),
            action_id,
            mentioned_by: Some(owner()),
            mentioned: vec![
                user("carol@macro.com"),
                user("alice@macro.com"),
                user("carol@macro.com"),
            ],
        },
    ));

    let [PlannedNotification::Mentioned(notify)] = actions.as_slice() else {
        panic!("expected one mention notification, got {actions:#?}");
    };
    assert_eq!(
        notify.recipients,
        vec![user("carol@macro.com"), user("alice@macro.com")]
    );
    assert_eq!(notify.metadata.mentioned_by, Some(owner()));
    assert_eq!(notify.metadata.action_id, action_id.as_uuid());
    assert_eq!(
        notify.notification_id,
        mentioned_notification_id(SESSION, action_id.as_uuid())
    );
}

#[test]
fn a_mention_of_nobody_is_nothing() {
    let actions = coder(&AgentSessionLifecycleEvent::Mentioned(
        SessionMentionedMetadata {
            identity: identity(),
            action_id: AgentActionId::mint(),
            mentioned_by: Some(owner()),
            mentioned: Vec::new(),
        },
    ));

    assert!(actions.is_empty());
}

#[test]
fn facts_that_are_not_news_to_people_plan_nothing() {
    for event in [
        // Retractions are deliberately not planned yet; see the module docs.
        AgentSessionLifecycleEvent::InputReceived(InputReceivedMetadata {
            identity: identity(),
            turn: TurnId(3),
            action_id: AgentActionId::mint(),
        }),
        AgentSessionLifecycleEvent::TurnStarted(TurnStartedMetadata {
            identity: identity(),
            turn: TurnId(5),
            action_id: AgentActionId::mint(),
            actor: Some(owner()),
            announcement_message_id: None,
        }),
        AgentSessionLifecycleEvent::Opened(SessionOpenedMetadata {
            identity: identity(),
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
        }),
        AgentSessionLifecycleEvent::Deleted(SessionDeletedMetadata {
            identity: identity(),
        }),
    ] {
        assert!(coder(&event).is_empty(), "{event:?}");
    }
}

#[test]
fn a_notify_becomes_a_realtime_and_push_request_with_its_own_id() {
    let notify = one_settled(coder(&settled(identity(), 2)));
    let expected_id = notify.notification_id;

    let request = notify.into_request();
    let value = serde_json::to_value(&request).expect("requests serialize for the ingress queue");

    assert_eq!(value["uuid_to_write"], expected_id.to_string());
    assert_eq!(value["send_conn_gateway"], true);
    assert!(value["build_apns"].is_object(), "push is built: {value:#}");
    assert!(
        value["req"]["sender_id"].is_null(),
        "a bot is nobody's sender"
    );
    assert_eq!(value["req"]["notification"]["tag"], "agent_session_settled");
}
