use super::*;
use harness_id::HarnessId;

#[tokio::test]
async fn closing_stdin_stops_an_embedded_service() {
    use std::future::Future as _;
    use std::task::Poll;

    let (reader, writer) = tokio::io::duplex(1);
    drop(writer);
    let closed = stdin_closed(reader, false);
    tokio::pin!(closed);

    let state = std::future::poll_fn(|cx| Poll::Ready(closed.as_mut().poll(cx))).await;
    assert!(state.is_ready());
}

#[tokio::test]
async fn closing_stdin_does_not_stop_a_managed_system_service() {
    use std::future::Future as _;
    use std::task::Poll;

    let (reader, writer) = tokio::io::duplex(1);
    drop(writer);
    let closed = stdin_closed(reader, true);
    tokio::pin!(closed);

    let state = std::future::poll_fn(|cx| Poll::Ready(closed.as_mut().poll(cx))).await;
    assert!(state.is_pending());
}

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
            ignore_stdin_eof: false,
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
            ignore_stdin_eof: false,
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
        pairing_id: None,
    };
    ConfigForm::load(&path)
        .expect("load form")
        .persist_credentials(&credentials)
        .expect("persist credentials");

    let moved = directory.path().join("elsewhere");
    configure(
        &path,
        &ServiceOptions {
            ignore_stdin_eof: false,
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
fn reconfiguring_drops_settings_older_releases_wrote() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let workspace = directory.path().join("workspace");
    std::fs::write(
        &path,
        format!(
            r#"[identity]
name = "laptop"
allow_permission_bypass = true

[server]
port = 8080

[credentials]
harness_id = "{harness_id}"
token = "mhns_test_secret"
scope = "personal"

[harness]
command = "hermes"
args = ["acp"]

[workspace]
path = "{workspace}"
"#,
            harness_id = HarnessId::TEST_A,
            workspace = workspace.display(),
        ),
    )
    .expect("write old config");
    assert!(Config::load(&path).is_err());

    configure(
        &path,
        &ServiceOptions {
            ignore_stdin_eof: false,
            config: None,
            agent: Some("custom".to_owned()),
            workspace: Some(workspace.clone()),
        },
        Some(agent_catalog::custom("hermes acp").expect("custom agent")),
    )
    .expect("reconfigure an old config");

    let config = Config::load(&path).expect("load migrated config");
    assert_eq!(
        config.credentials,
        Some(HarnessCredentials {
            harness_id: HarnessId::TEST_A,
            token: "mhns_test_secret".to_owned(),
            pairing_id: None,
        })
    );
    assert_eq!(config.workspace.path, workspace);
}

#[test]
fn creating_a_config_requires_an_agent() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("macrod.toml");
    let error = configure(
        &path,
        &ServiceOptions {
            ignore_stdin_eof: false,
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
