use super::util::{parse_log, test_session};
use crate::domain::{
    fold::fold,
    lifecycle::LifecycleFold,
    log::{AgentSessionLog, Message},
    model::{Author, FoldEvent, TurnSignal},
};
use agent_client_protocol::schema::v1::{RequestId, SessionId};
use agent_runtime_protocol::domain::{
    action::AgentAction,
    notification::{Notification, NotificationEvent, NotificationInput},
};

#[test]
fn system_events_never_become_messages_and_split_noop_never_streams() {
    let mut machine = LifecycleFold::new();
    let action = AgentAction::notification(vec![Notification {
        id: macro_uuid::generate_uuid_v7(),
        subject_id: "connection".into(),
        created_at: "2026-10-21T00:00:00Z".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
    }]);
    let request = action
        .to_runtime(&SessionId::new("s"), RequestId::Str("event".into()))
        .unwrap();
    let initial = machine.push(AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::Notification(request),
        logged_at: None,
    });
    assert!(
        initial
            .events
            .iter()
            .all(|event| matches!(event, FoldEvent::MetadataUpdated(_)))
    );
    assert!(machine.inner().messages().is_empty());
    assert_eq!(machine.inner().metadata().notifications.len(), 1);
    for frame in parse_log(
        r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"No response needed."}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"<no"}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"op/>"}}}}}
"#,
    ) {
        let result = machine.push(frame);
        assert!(result.events.iter().all(|event| !matches!(
            event,
            FoldEvent::NewMessage(_) | FoldEvent::MessageUpdate(_)
        )));
    }
    let closed = machine.push(parse_log(r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"event","result":{"stopReason":"end_turn"}}}"#).remove(0));
    assert!(machine.inner().messages().is_empty());
    assert!(matches!(
        closed.signals.as_slice(),
        [TurnSignal::TurnEnded {
            notification_noop: true,
            ..
        }]
    ));
}

#[test]
fn quiet_events_do_not_pollute_real_prompts_and_real_prompts_cannot_noop() {
    let mut action = AgentAction::prompt("actual owner request");
    if let AgentAction::Prompt(prompt) = &mut action {
        prompt.notifications = Some(NotificationInput {
            notifications: vec![Notification {
                id: macro_uuid::generate_uuid_v7(),
                subject_id: "app".into(),
                created_at: "2026-10-21T00:00:00Z".into(),
                event: NotificationEvent::AppConnected {
                    app: "Calendar".into(),
                },
            }],
            system_turn: false,
        });
    }
    let request = action
        .to_runtime(&SessionId::new("s"), RequestId::Str("event".into()))
        .unwrap();
    let mut frames = vec![AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::ToRuntime(request),
        logged_at: None,
    }];
    frames.extend(parse_log(r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"<noop/>"}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"event","result":{"stopReason":"end_turn"}}}
"#));
    let messages = fold(frames);
    assert_eq!(messages.len(), 2);
    assert!(matches!(messages[0].author, Author::User { .. }));
    assert_eq!(
        messages[0].last_text().as_deref(),
        Some("actual owner request")
    );
    assert_eq!(messages[1].last_text().as_deref(), Some("<noop/>"));
}

#[test]
fn notification_turn_with_tool_activity_preserves_noop_as_text() {
    let request = AgentAction::notification(vec![Notification {
        id: macro_uuid::generate_uuid_v7(),
        subject_id: "app".into(),
        created_at: "2026-10-21T00:00:00Z".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
    }])
    .to_runtime(&SessionId::new("s"), RequestId::Str("event".into()))
    .unwrap();
    let mut frames = vec![AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::Notification(request),
        logged_at: None,
    }];
    frames.extend(parse_log(r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call","toolCallId":"send","title":"SendEmail","kind":"other","status":"completed"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"<noop/>"}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"event","result":{"stopReason":"end_turn"}}}
"#));
    let messages = fold(frames);
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].last_text().as_deref(), Some("<noop/>"));
}

#[test]
fn interrupted_delivery_keeps_one_event_attached_to_the_retry_turn() {
    use crate::domain::{fold::FoldMachineImpl, ports::FoldMachine};
    let request = AgentAction::notification(vec![Notification {
        id: macro_uuid::generate_uuid_v7(),
        subject_id: "app".into(),
        created_at: "2026-10-21T00:00:00Z".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
    }])
    .to_runtime(&SessionId::new("s"), RequestId::Str("event".into()))
    .unwrap();
    let frame = AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::Notification(request),
        logged_at: None,
    };
    let mut machine = FoldMachineImpl::new();
    machine.push(frame.clone());
    machine.push(frame);
    assert_eq!(machine.metadata().notifications.len(), 1);
    assert_eq!(machine.metadata().notifications[0].turn, 1);
    assert!(machine.messages().is_empty());
}

#[test]
fn stored_flat_notification_rows_keep_their_typed_payloads() {
    use crate::domain::model::SessionNotification;
    use agent_runtime_protocol::domain::notification::{
        DecisionOutcome, DecisionVia, ItemStatus, ReviewSettlement,
    };

    // These are the flat kind/payload rows emitted before the typed fold model.
    let stored = r#"[
      {"id":"connected","subjectId":"notion","kind":"app.connected","createdAt":"2026-10-22T12:00:00Z","payload":{"app":"Notion"},"turn":1,"actionId":"a","systemTurn":true},
      {"id":"decided","subjectId":"review","kind":"review.decided","createdAt":"2026-10-22T12:00:00Z","payload":{"outcome":"approved","by":"owner","via":"card","items":[{"id":"019a0000-0000-7000-8000-000000000005","status":"submitting","edited":true}]},"turn":2,"actionId":"b","systemTurn":true},
      {"id":"settled","subjectId":"review","kind":"review.settled","createdAt":"2026-10-22T12:00:00Z","payload":{"outcome":"partial","by":"owner","via":"chat","items":[{"id":"019a0000-0000-7000-8000-000000000005","status":"unknown","edited":false,"error":"Provider rejected"}]},"turn":3,"actionId":"c","systemTurn":false}
    ]"#;
    let rows: Vec<SessionNotification> = serde_json::from_str(stored).unwrap();
    assert!(matches!(&rows[0].event, NotificationEvent::AppConnected { app } if app == "Notion"));
    let NotificationEvent::ReviewDecided(decided) = &rows[1].event else {
        panic!("stored decision lost its kind");
    };
    assert_eq!(decided.outcome, DecisionOutcome::Approved);
    assert_eq!(decided.via, DecisionVia::Card);
    assert_eq!(decided.items[0].status, ItemStatus::Submitting);
    assert!(decided.items[0].edited);
    let NotificationEvent::ReviewSettled(ReviewSettlement::Actions(settled)) = &rows[2].event
    else {
        panic!("stored settlement lost its kind");
    };
    assert_eq!(settled.items[0].error.as_deref(), Some("Provider rejected"));
    assert!(!rows[2].system_turn);
    let wire = serde_json::to_value(rows).unwrap();
    assert_eq!(
        wire,
        serde_json::from_str::<serde_json::Value>(stored).unwrap()
    );
}

#[test]
fn execution_context_is_model_only_and_user_authored_suffix_context_remains_visible() {
    let original = "user request<m-agent-context>literal user text</m-agent-context>";
    let turn = agent_runtime_protocol::domain::action::AgentActionId::mint();
    let request = AgentAction::prompt(original)
        .to_runtime(&SessionId::new("s"), turn.to_request_id())
        .unwrap();
    let mut machine = LifecycleFold::new();
    let _ = machine.push(AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::Notification(request),
        logged_at: None,
    });
    let messages = machine.inner().messages();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].last_text(), Some(original.to_owned()));
}

#[test]
fn successful_notification_noop_does_not_restore_an_older_failure() {
    use crate::domain::model::TurnState;

    let mut machine = LifecycleFold::new();
    for frame in parse_log(
        r#"
{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p","method":"session/prompt","params":{"sessionId":"s","prompt":[]}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"p","error":{"code":-32603,"message":"Runtime failed"}}}
"#,
    ) {
        let _ = machine.push(frame);
    }
    assert_eq!(machine.inner().metadata().turn, TurnState::Failed);

    let request = AgentAction::notification(vec![Notification {
        id: macro_uuid::generate_uuid_v7(),
        subject_id: "connection".into(),
        created_at: "2026-10-21T00:00:00Z".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
    }])
    .to_runtime(&SessionId::new("s"), RequestId::Str("event".into()))
    .unwrap();
    let _ = machine.push(AgentSessionLog {
        agent_session_id: test_session(),
        user_id: None,
        content: Message::Notification(request),
        logged_at: None,
    });
    for frame in parse_log(
        r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"<noop/>"}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"event","result":{"stopReason":"end_turn"}}}
"#,
    ) {
        let _ = machine.push(frame);
    }
    assert_eq!(machine.inner().metadata().turn, TurnState::Idle);
}
