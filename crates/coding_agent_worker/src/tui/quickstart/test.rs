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
        allow_permission_bypass: false,
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Scope);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::PermissionBypass);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);
    quickstart.on_key(key(KeyCode::Up));
    assert_eq!(quickstart.focus, QuickstartFocus::PermissionBypass);
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
        allow_permission_bypass: false,
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Tab));
    quickstart.on_key(key(KeyCode::Tab));
    quickstart.on_key(key(KeyCode::Tab));
    assert_eq!(quickstart.focus, QuickstartFocus::PermissionBypass);
    quickstart.on_key(key(KeyCode::Tab));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);

    quickstart.on_key(key(KeyCode::BackTab));
    assert_eq!(quickstart.focus, QuickstartFocus::PermissionBypass);
}

#[test]
fn custom_agent_reedit_preserves_arguments() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: Some(agent_catalog::custom("agent --mode 'acp bridge'").unwrap()),
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        scope: IdentityScope::Private,
        allow_permission_bypass: false,
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
        env: Default::default(),
    });
    let agents = vec![DetectedAgent {
        kind: AgentKind::Hermes,
        name: "Hermes",
        launch: agent_catalog::LaunchSpec {
            command: "hermes".to_owned(),
            args: vec!["acp".to_owned()],
            env: Default::default(),
        },
        note: None,
        install: None,
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
        env: Default::default(),
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

#[test]
fn permission_bypass_defaults_off_and_can_be_toggled() {
    let mut setup = Quickstart::from_config_with_agents(
        &config(Harness {
            command: "hermes".to_owned(),
            args: vec!["acp".to_owned()],
            env: Default::default(),
        }),
        Vec::new(),
    );
    assert!(!setup.allow_permission_bypass);
    setup.focus = QuickstartFocus::PermissionBypass;
    setup.on_key(key(KeyCode::Enter));
    assert!(setup.allow_permission_bypass);
    setup.on_key(key(KeyCode::Enter));
    assert!(!setup.allow_permission_bypass);
}

#[test]
fn unpaired_config_prefills_permission_bypass_consent() {
    let mut config = config(Harness {
        command: "hermes".to_owned(),
        args: vec!["acp".to_owned()],
        env: Default::default(),
    });
    config.identity.allow_permission_bypass = true;
    let setup = Quickstart::from_config_with_agents(&config, Vec::new());
    assert!(setup.allow_permission_bypass);
}

#[test]
fn quickstart_renders_permission_consent_and_warning() {
    use ratatui::{Terminal, backend::TestBackend};
    let mut setup = Quickstart::from_config_with_agents(
        &config(Harness {
            command: "hermes".to_owned(),
            args: vec!["acp".to_owned()],
            env: Default::default(),
        }),
        Vec::new(),
    );
    for allowed in [false, true] {
        setup.allow_permission_bypass = allowed;
        let mut terminal = Terminal::new(TestBackend::new(100, 40)).unwrap();
        terminal
            .draw(|frame| {
                crate::tui::ui::render_quickstart(
                    frame,
                    &setup,
                    std::path::Path::new("macrod.toml"),
                )
            })
            .unwrap();
        let screen = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(screen.contains("Full Access"));
        assert!(screen.contains(if allowed {
            "[x] On"
        } else {
            "[ ] Off (always prompt)"
        }));
        assert_eq!(screen.contains("without approval"), allowed);
        assert!(screen.contains("Create and pair"));
        let rows = terminal
            .backend()
            .buffer()
            .content()
            .chunks(100)
            .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>();
        let workspace = rows.iter().find(|row| row.contains("Workspace")).unwrap();
        let scope = rows
            .iter()
            .find(|row| row.contains("Access") && !row.contains("Full Access"))
            .unwrap();
        let full_access = rows.iter().find(|row| row.contains("Full Access")).unwrap();
        assert_eq!(workspace.find("/existing/workspace"), scope.find("Team"));
        assert_eq!(workspace.find("/existing/workspace"), full_access.find('['));
    }
}
