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
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);
    quickstart.on_key(key(KeyCode::Down));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);
    quickstart.on_key(key(KeyCode::Up));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
    assert!(quickstart.selected_agent.is_none());
}

#[test]
fn tab_and_shift_tab_reach_and_leave_the_submit_button() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: None,
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
        mode: QuickstartMode::Normal,
        status: None,
    };

    quickstart.on_key(key(KeyCode::Tab));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
    quickstart.on_key(key(KeyCode::Tab));
    assert_eq!(quickstart.focus, QuickstartFocus::Submit);

    quickstart.on_key(key(KeyCode::BackTab));
    assert_eq!(quickstart.focus, QuickstartFocus::Workspace);
}

#[test]
fn custom_agent_reedit_preserves_arguments() {
    let mut quickstart = Quickstart {
        agents: Vec::new(),
        selected_agent: Some(agent_catalog::custom("agent --mode 'acp bridge'").unwrap()),
        focus: QuickstartFocus::Agent(0),
        workspace: "/tmp".to_owned(),
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
fn unpaired_config_prefills_recognized_agent_and_workspace() {
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
    config.harness = harness;
    config.workspace = Workspace {
        path: "/existing/workspace".into(),
        repo_url: None,
    };
    config
}

#[test]
fn quickstart_renders_the_form_at_small_sizes() {
    use ratatui::{Terminal, backend::TestBackend};
    let mut setup = Quickstart::from_config_with_agents(
        &config(Harness {
            command: "hermes".to_owned(),
            args: vec!["acp".to_owned()],
            env: Default::default(),
        }),
        Vec::new(),
    );
    for (width, height, status) in [
        (100, 40, false),
        (80, 26, false),
        (80, 26, true),
        (80, 24, false),
        (80, 24, true),
    ] {
        setup.status = status.then(|| ("Pairing failed".to_owned(), true));
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
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
        assert!(screen.contains("Workspace"));
        assert!(screen.contains("set on the web"));
        assert!(screen.contains("Create and pair"));
    }
}

#[test]
fn quickstart_groups_herdr_agents_apart_from_headless_ones() {
    use crate::tui::agent_catalog::LaunchSpec;
    use ratatui::{Terminal, backend::TestBackend};
    let agent = |kind, name| DetectedAgent {
        kind,
        name,
        launch: LaunchSpec {
            command: "agent".to_owned(),
            args: Vec::new(),
            env: Default::default(),
        },
        note: None,
        install: None,
    };
    let setup = Quickstart {
        agents: vec![
            agent(AgentKind::HerdrClaude, "Claude Code in herdr"),
            agent(AgentKind::HerdrCodex, "Codex in herdr"),
            agent(AgentKind::ClaudeCode, "Claude Code"),
        ],
        selected_agent: None,
        focus: QuickstartFocus::Agent(1),
        workspace: "/tmp".to_owned(),
        mode: QuickstartMode::Normal,
        status: None,
    };
    let mut terminal = Terminal::new(TestBackend::new(100, 40)).unwrap();
    terminal
        .draw(|frame| {
            crate::tui::ui::render_quickstart(frame, &setup, std::path::Path::new("macrod.toml"))
        })
        .unwrap();
    let rows = terminal
        .backend()
        .buffer()
        .content()
        .chunks(100)
        .map(|row| {
            row.iter()
                .map(|cell| cell.symbol())
                .collect::<String>()
                .trim_end()
                .to_owned()
        })
        .collect::<Vec<_>>();
    let position = |text: &str| rows.iter().position(|row| row.contains(text)).unwrap();
    assert!(position("Herdr") < position("▸ ○ Codex"));
    assert!(position("▸ ○ Codex") < position("ACP"));
    let headless = rows
        .iter()
        .rposition(|row| row.contains("○ Claude Code"))
        .unwrap();
    assert!(position("○ Claude Code") < position("ACP"));
    assert!(position("ACP") < headless);
    assert!(!rows.iter().any(|row| row.contains("in herdr")));
}
