use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use super::*;
use crate::config::{Harness, MacroApi, Workspace};

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn quickstart_uses_one_flat_focus_order_without_preselecting_an_agent() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: None,
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        scope: IdentityScope::Private,
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Scope);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);
    quickstart.on_key(key(KeyCode::Up));
    assert_eq!(quickstart.focus, QuickstartFocus::Scope);
    assert!(quickstart.selected_agent.is_none());
}

#[test]
fn tab_and_shift_tab_reach_and_leave_the_submit_button() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: None,
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        scope: IdentityScope::Private,
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Tab));
    quickstart.on_key(key(KeyCode::Tab));
    quickstart.on_key(key(KeyCode::Tab));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);

    quickstart.on_key(key(KeyCode::BackTab));
    assert_eq!(quickstart.focus, QuickstartFocus::Scope);
}

#[test]
fn custom_agent_reedit_preserves_arguments() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: Some(agent_catalog::custom("agent --mode 'acp bridge'").unwrap()),
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        scope: IdentityScope::Private,
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Enter));

    let QuickstartMode::CustomAgent { buffer } = quickstart.mode else {
        panic!("custom command should enter edit mode");
    };
    assert_eq!(buffer.value(), "agent --mode 'acp bridge'");
}

#[test]
fn unpaired_config_prefills_recognized_agent_workspace_and_scope() {
    let config = config(Harness {
        command: "hermes".to_owned(),
        args: vec!["acp".to_owned()],
    });
    let agents = vec![DetectedAgent {
        kind: AgentKind::Hermes,
        name: "Hermes",
        launch: agent_catalog::LaunchSpec {
            command: "hermes".to_owned(),
            args: vec!["acp".to_owned()],
        },
        note: None,
    }];

    let quickstart = Quickstart::from_config_with_agents(&config, agents);

    assert_eq!(quickstart.selected_agent.unwrap().kind, AgentKind::Hermes);
    assert_eq!(quickstart.workspace, "/existing/workspace");
    assert_eq!(quickstart.scope, IdentityScope::Team);
    assert_eq!(quickstart.focus, QuickstartFocus::Agent(0));
}

#[test]
fn unpaired_config_prefills_custom_command_with_all_arguments() {
    let config = config(Harness {
        command: "my-agent".to_owned(),
        args: vec!["--mode".to_owned(), "acp bridge".to_owned()],
    });

    let quickstart = Quickstart::from_config_with_agents(&config, Vec::new());
    let selected = quickstart.selected_agent.expect("selected custom agent");

    assert_eq!(selected.kind, AgentKind::Custom);
    assert_eq!(selected.launch.command, "my-agent");
    assert_eq!(selected.launch.args, ["--mode", "acp bridge"]);
    assert_eq!(quickstart.focus, QuickstartFocus::Agent(0));
}

fn config(harness: Harness) -> Config {
    let mut config: Config =
        toml::from_str(include_str!("../../../config.example.toml")).expect("example config");
    config.macro_api = MacroApi {
        api_url: "https://agent-harness.example.com".to_owned(),
        storage_url: "https://storage.example.com".to_owned(),
        web_url: "https://example.com/app".to_owned(),
    };
    config.identity.scope = IdentityScope::Team;
    config.harness = harness;
    config.workspace = Workspace {
        path: "/existing/workspace".into(),
        repo_url: None,
    };
    config
}
