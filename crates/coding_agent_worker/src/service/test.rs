use super::*;
use crate::config::HarnessScope;
use harness_id::HarnessId;

#[test]
fn creates_a_config_from_setup_flags() {
    let directory = tempfile::tempdir().expect("temp dir");
    // Neither the config directory nor the workspace exist yet; setup
    // creates both.
    let path = directory.path().join("state").join("macrod.toml");
    let workspace = directory.path().join("workspace");
    let agent = agent_catalog::custom("hermes acp").expect("custom agent");

    configure(
        &path,
        &ServiceOptions {
            config: None,
            agent: Some("custom".to_owned()),
            workspace: Some(workspace.clone()),
        },
        Some(agent),
    )
    .expect("configure");

    let config = Config::load(&path).expect("load created config");
    assert_eq!(config.harness.command, "hermes");
    assert_eq!(config.harness.args, ["acp"]);
    assert_eq!(config.workspace.path, workspace);
    assert!(workspace.is_dir());
    assert!(config.credentials.is_none());
}

#[test]
fn reconfigures_without_dropping_credentials() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let workspace = directory.path().join("workspace");
    let agent = agent_catalog::custom("hermes acp").expect("custom agent");
    configure(
        &path,
        &ServiceOptions {
            config: None,
            agent: Some("custom".to_owned()),
            workspace: Some(workspace),
        },
        Some(agent),
    )
    .expect("configure");

    let credentials = HarnessCredentials {
        harness_id: HarnessId::TEST_A,
        token: "mhns_test_secret".to_owned(),
        scope: HarnessScope::User,
    };
    ConfigForm::load(&path)
        .expect("load form")
        .persist_credentials(&credentials)
        .expect("persist credentials");

    let moved = directory.path().join("elsewhere");
    configure(
        &path,
        &ServiceOptions {
            config: None,
            agent: None,
            workspace: Some(moved.clone()),
        },
        None,
    )
    .expect("reconfigure");

    let config = Config::load(&path).expect("load edited config");
    assert_eq!(config.credentials, Some(credentials));
    assert_eq!(config.workspace.path, moved);
    // Untouched settings survive the edit.
    assert_eq!(config.harness.command, "hermes");
}

#[test]
fn creating_a_config_requires_an_agent() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let error = configure(
        &path,
        &ServiceOptions {
            config: None,
            agent: None,
            workspace: Some(directory.path().to_owned()),
        },
        None,
    )
    .expect_err("creation without an agent must fail");
    assert!(format!("{error}").contains("--agent"));
}

#[test]
fn fatal_root_message_keeps_the_root_line() {
    assert_eq!(
        fatal_root_message("\n ● the pairing code expired\n ╰ crates/x.rs:1\n"),
        "the pairing code expired"
    );
    assert_eq!(fatal_root_message("plain failure"), "plain failure");
}
