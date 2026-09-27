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
