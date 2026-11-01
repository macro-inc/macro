use super::acp_agent::TuiAgent;
use super::*;

fn harness(args: &[&str]) -> Harness {
    Harness {
        command: "/bin/macrod".to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        env: Default::default(),
    }
}

#[test]
fn herdr_harnesses_name_their_agent() {
    assert_eq!(
        herdr_agent(&harness(&["herdr-acp"])),
        Some(TuiAgent::Claude)
    );
    assert_eq!(
        herdr_agent(&harness(&["herdr-acp", "--permission-mode", "acceptEdits"])),
        Some(TuiAgent::Claude)
    );
    assert_eq!(
        herdr_agent(&harness(&["herdr-acp", "--kind", "codex"])),
        Some(TuiAgent::Codex)
    );
    assert_eq!(
        herdr_agent(&harness(&[
            "herdr-acp",
            "--kind=codex",
            "--",
            "--kind",
            "claude"
        ])),
        Some(TuiAgent::Codex)
    );
    assert_eq!(herdr_agent(&harness(&["acp"])), None);
    assert!(!drives_herdr(&harness(&["acp"])));
}

#[test]
fn instance_settings_keep_native_arguments_after_the_separator() {
    let mut launch = harness(&[
        "herdr-acp",
        "--kind",
        "codex",
        "--",
        "--sandbox",
        "workspace-write",
    ]);
    let settings = crate::config::HerdrSettings {
        model: Some("custom-model".to_owned()),
        arguments: vec![
            "--config".to_owned(),
            "model_reasoning_effort=\"high\"".to_owned(),
        ],
        focus: false,
        ..Default::default()
    };
    configure_launch(
        &mut launch,
        &settings,
        std::path::Path::new("/private state"),
    );
    assert_eq!(
        launch.args,
        [
            "herdr-acp",
            "--kind",
            "codex",
            "--state-dir",
            "/private state",
            "--managed-worktrees",
            "--model=custom-model",
            "--no-focus",
            "--",
            "--sandbox",
            "workspace-write",
            "--config",
            "model_reasoning_effort=\"high\"",
        ]
    );
}

#[test]
fn viewer_states_encode_as_program_status_reports() {
    use wire::AgentState;
    assert_eq!(
        AgentState::Working.osc_7501(None),
        "\x1b]7501;state=working:app=macro\x1b\\"
    );
    assert_eq!(
        AgentState::Blocked.osc_7501(Some("Run ls?")),
        "\x1b]7501;state=blocked:app=macro:kind=permission:msg=UnVuIGxzPw==\x1b\\"
    );
}
