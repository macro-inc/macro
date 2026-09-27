use super::*;

fn owner() -> Owner {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn macro_id(n: u128) -> AgentSessionId {
    AgentSessionId::new_from_uuid(uuid::Uuid::from_u128(n))
}

fn state() -> (HubState, mpsc::UnboundedReceiver<Work>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (HubState::new(tx), rx)
}

fn drain(rx: &mut mpsc::UnboundedReceiver<Work>) -> Vec<Work> {
    std::iter::from_fn(|| rx.try_recv().ok()).collect()
}

fn opened(session: &str, macro_session: Option<AgentSessionId>) -> TapEvent {
    TapEvent::Opened {
        session: session.to_owned(),
        macro_session,
    }
}

#[test]
fn a_named_session_opens_one_window_and_is_steerable() {
    let (mut hub, mut work) = state();
    hub.session_created(macro_id(1), owner());
    hub.apply(opened("acp-1", Some(macro_id(1))));
    // A later load of the same session does not open a second window.
    hub.apply(opened("acp-1", Some(macro_id(1))));

    assert_eq!(
        drain(&mut work),
        [
            Work::Open {
                session: "acp-1".to_owned()
            },
            Work::Report {
                session: "acp-1".to_owned(),
                state: AgentState::Idle,
                message: None,
            },
        ]
    );
    assert_eq!(
        hub.control_target("acp-1"),
        Some((macro_id(1), owner()))
    );
    assert!(hub.unclaimed_macro.is_empty());
}

#[test]
fn unnamed_sessions_pair_with_created_ones_in_order_either_way() {
    let (mut hub, _work) = state();
    // The create answered before the agent did.
    hub.session_created(macro_id(1), owner());
    hub.apply(opened("acp-1", None));
    // The agent answered before the create did.
    hub.apply(opened("acp-2", None));
    hub.session_created(macro_id(2), owner());

    assert_eq!(hub.control_target("acp-1").map(|t| t.0), Some(macro_id(1)));
    assert_eq!(hub.control_target("acp-2").map(|t| t.0), Some(macro_id(2)));
}

#[test]
fn a_session_without_an_owner_is_view_only() {
    let (mut hub, _work) = state();
    hub.apply(opened("acp-1", Some(macro_id(1))));
    assert_eq!(hub.control_target("acp-1"), None);
    hub.owners.insert(macro_id(1), owner());
    assert!(hub.control_target("acp-1").is_some());
}

#[test]
fn a_turn_titles_the_window_once_and_reports_each_state() {
    let (mut hub, mut work) = state();
    hub.apply(opened("s", None));
    drain(&mut work);

    hub.apply(TapEvent::Prompted {
        session: "s".to_owned(),
        text: "\n  Fix the flaky login test in the auth service please\nmore".to_owned(),
    });
    hub.apply(TapEvent::Prompted {
        session: "s".to_owned(),
        text: "second".to_owned(),
    });
    hub.apply(TapEvent::TurnEnded {
        session: "s".to_owned(),
        stop_reason: "end_turn".to_owned(),
    });

    let work = drain(&mut work);
    let titles: Vec<_> = work
        .iter()
        .filter_map(|item| match item {
            Work::Title { title, .. } => Some(title.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(titles, ["Fix the flaky login test in the auth service ple…"]);
    let states: Vec<_> = work
        .iter()
        .filter_map(|item| match item {
            Work::Report { state, .. } => Some(*state),
            _ => None,
        })
        .collect();
    assert_eq!(
        states,
        [AgentState::Working, AgentState::Working, AgentState::Idle]
    );
}

#[test]
fn windows_replay_the_backlog_and_follow_live() {
    let (mut hub, _work) = state();
    hub.apply(opened("s", None));
    hub.apply(TapEvent::Prompted {
        session: "s".to_owned(),
        text: "hi".to_owned(),
    });
    let (tx, mut rx) = mpsc::unbounded_channel();
    let view = hub.sessions.get_mut("s").unwrap();
    assert_eq!(
        view.backlog.front(),
        Some(&ToPane::Prompted {
            text: "hi".to_owned()
        })
    );
    view.subscribers.push(tx);

    hub.apply(TapEvent::PermissionAsked {
        session: "s".to_owned(),
        request_id: serde_json::json!(4),
        title: Some("Edit main.rs".to_owned()),
        options: Vec::new(),
    });
    assert_eq!(
        rx.try_recv().unwrap(),
        ToPane::Permission {
            request_id: serde_json::json!(4),
            title: Some("Edit main.rs".to_owned()),
            options: Vec::new(),
        }
    );
    assert_eq!(
        rx.try_recv().unwrap(),
        ToPane::State {
            state: AgentState::Blocked,
            detail: Some("Edit main.rs".to_owned()),
        }
    );
}
