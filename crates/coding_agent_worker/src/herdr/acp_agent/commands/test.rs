use super::*;
use agent_fold::domain::fold::FoldMachineImpl;
use agent_fold::domain::log::{AgentSessionId, AgentSessionLog};
use agent_fold::domain::ports::FoldMachine as _;

#[test]
fn advertised_commands_reach_macro_metadata_for_each_provider() {
    for (kind, expected) in [
        (TuiAgent::Claude, vec!["compact", "init", "fast"]),
        (
            TuiAgent::Codex,
            vec!["compact", "init", "fast", "ultrafast"],
        ),
    ] {
        let mut fold = FoldMachineImpl::new();
        fold.push(AgentSessionLog {
            agent_session_id: AgentSessionId::new(),
            user_id: None,
            content: serde_json::from_value(json!({
                "direction": "to_server",
                "content": {
                    "type": "acp", "jsonrpc": "2.0", "method": "session/update",
                    "params": {"sessionId": "test", "update": available(kind)},
                },
            }))
            .unwrap(),
        });
        let names: Vec<_> = fold
            .metadata()
            .available_commands
            .iter()
            .map(|command| command.name.as_str())
            .collect();
        assert_eq!(names, expected);
        assert!(!names.contains(&"resume"));
        assert!(!names.contains(&"new"));
        assert!(!names.contains(&"fork"));
    }
}

#[test]
fn only_standalone_provider_speed_controls_complete_on_delivery() {
    for (kind, text) in [
        (TuiAgent::Claude, "/fast"),
        (TuiAgent::Claude, " /fast on "),
        (TuiAgent::Claude, "/fast off"),
        (TuiAgent::Codex, "/fast"),
        (TuiAgent::Codex, "/ultrafast"),
    ] {
        assert_eq!(native_control(kind, text), Some(text.trim()));
    }
    for kind in [TuiAgent::Claude, TuiAgent::Codex] {
        for text in [
            "",
            "hi",
            "/compact",
            "/init",
            "/custom-skill",
            "/fastest",
            "explain /fast",
            "/fast explain this",
            "/fast\nfix the bug",
            "/fast\roff",
        ] {
            assert_eq!(native_control(kind, text), None, "{kind:?}: {text:?}");
        }
    }
    assert_eq!(native_control(TuiAgent::Claude, "/ultrafast"), None);
    assert_eq!(native_control(TuiAgent::Claude, "/fast on extra"), None);
    assert_eq!(native_control(TuiAgent::Codex, "/fast on"), None);
}
