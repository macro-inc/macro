use super::*;

#[test]
fn tabs_wrap_in_both_directions() {
    assert_eq!(Tab::Overview.previous(), Tab::Logs);
    assert_eq!(Tab::Overview.next(), Tab::Sessions);
    assert_eq!(Tab::Logs.next(), Tab::Overview);
    assert_eq!(Tab::Logs.previous(), Tab::Config);
}

#[tokio::test]
async fn choosing_an_agent_waits_for_mcp_setup_before_changing_config() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, include_str!("../../../config.example.toml")).unwrap();
    let mut app = App::load(&path, LogBuffer::default()).unwrap();
    let original = std::fs::read_to_string(&path).unwrap();
    let agent = agent_catalog::custom("test-agent acp").unwrap();
    app.select_agent(agent.clone()).await;
    assert_eq!(app.pending_agent_setup.as_ref(), Some(&agent));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    // The runner calls apply_agent only after MCP setup succeeds.
    app.apply_agent(&agent).await;
    assert_eq!(Config::load(&path).unwrap().harness.command, "test-agent");
}

#[tokio::test]
async fn accepting_a_custom_command_waits_for_mcp_setup() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("macrod.toml");
    std::fs::write(&path, include_str!("../../../config.example.toml")).unwrap();
    let mut app = App::load(&path, LogBuffer::default()).unwrap();
    let original = std::fs::read_to_string(&path).unwrap();
    app.mode = Mode::CustomAgent {
        buffer: Input::new("custom-agent acp".to_owned()),
    };
    app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE))
        .await;
    assert!(matches!(app.mode, Mode::Normal));
    assert_eq!(
        app.pending_agent_setup.as_ref(),
        Some(&agent_catalog::custom("custom-agent acp").unwrap())
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
}
