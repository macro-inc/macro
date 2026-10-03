use super::*;
use crate::tui::agent_catalog::LaunchSpec;

fn agent(kind: AgentKind) -> DetectedAgent {
    DetectedAgent {
        kind,
        name: "Test",
        launch: LaunchSpec::new("adapter", [])
            .with_env("CODEX_PATH", std::path::Path::new("/chosen/codex")),
        note: None,
        install: None,
    }
}

#[test]
fn every_builtin_configures_the_selected_deployment_and_authenticates() {
    let url = "https://dev-gateway.macro.com/mcp";
    for (kind, program, login) in [
        (AgentKind::Hermes, "hermes", "login"),
        (AgentKind::ClaudeCode, "claude", "login"),
        (AgentKind::Codex, "/chosen/codex", "login"),
        (AgentKind::OpenClaw, "openclaw", "login"),
        (AgentKind::OpenCode, "opencode", "auth"),
    ] {
        let agent = agent(kind);
        let plan = agent.mcp_setup(url).unwrap();
        assert_eq!(plan.commands.len(), 2);
        assert!(plan.commands[0].args.iter().any(|arg| arg.contains(url)));
        assert_eq!(plan.commands[1].args, ["mcp", login, "macro"]);
        for command in plan.commands {
            assert_eq!(command.program, program);
            assert_eq!(command.env, agent.launch.env);
        }
    }
}

#[test]
fn custom_harnesses_do_not_get_guessed_cli_commands() {
    assert!(
        agent(AgentKind::Custom)
            .mcp_setup("https://gateway.macro.com/mcp")
            .is_none()
    );
}
