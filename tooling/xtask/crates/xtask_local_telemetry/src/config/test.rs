use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use super::{Config, ConfigError, Setting, Switch};

fn on(setting: Setting) -> Config {
    match setting {
        Setting::On(config) => config,
        other => panic!("expected settings that send, got {other:?}"),
    }
}

const TOKEN: &str = "secret-0123456789abcdef0123456789abcdef";

fn write(dir: &Path, text: &str, mode: u32) -> PathBuf {
    let path = dir.join("local-telemetry.toml");
    std::fs::write(&path, text).expect("write config");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).expect("chmod");
    path
}

#[test]
fn no_file_means_provision_one() {
    let dir = tempfile::tempdir().expect("tempdir");
    let loaded = Config::load(&dir.path().join("local-telemetry.toml")).expect("load");
    assert!(matches!(loaded, Setting::Missing));
}

#[test]
fn enabled_false_turns_it_off_without_an_endpoint() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write(dir.path(), "enabled = false\n", 0o644);
    assert!(matches!(Config::load(&path).expect("load"), Setting::Off));
}

#[test]
fn the_environment_switch() {
    assert_eq!(Switch::parse(None, false), Switch::Default);
    assert_eq!(Switch::parse(Some("off"), false), Switch::Off);
    assert_eq!(Switch::parse(Some("0"), false), Switch::Off);
    assert_eq!(Switch::parse(None, true), Switch::Off);
    assert_eq!(Switch::parse(Some("on"), true), Switch::On);
    assert_eq!(Switch::parse(Some("off"), true), Switch::Off);
    assert_eq!(Switch::parse(Some("maybe"), false), Switch::Default);
}

#[test]
fn routes_follow_the_endpoint() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write(
        dir.path(),
        "endpoint = \"https://otlp.example.com/\"\ntoken = \"t\"\n",
        0o600,
    );
    let config = on(Config::load(&path).expect("load"));
    assert_eq!(config.logs_url(), "https://otlp.example.com/v1/logs");
    assert_eq!(
        config.traces_url().as_deref(),
        Some("https://otlp.example.com/v1/traces")
    );
}

#[test]
fn traces_can_be_turned_off() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write(
        dir.path(),
        "endpoint = \"http://127.0.0.1:3100/otlp\"\ntraces = false\n",
        0o644,
    );
    let config = on(Config::load(&path).expect("load"));
    assert_eq!(config.logs_url(), "http://127.0.0.1:3100/otlp/v1/logs");
    assert_eq!(config.traces_url(), None);
}

#[test]
fn a_token_readable_by_others_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write(
        dir.path(),
        &format!("endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\n"),
        0o644,
    );
    let error = Config::load(&path).expect_err("refused");
    assert!(matches!(error, ConfigError::Permissions { .. }));
}

#[test]
fn plain_http_is_only_for_this_machine() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write(
        dir.path(),
        "endpoint = \"http://otlp.example.com\"\ntoken = \"t\"\n",
        0o600,
    );
    let error = Config::load(&path).expect_err("refused");
    assert!(matches!(error, ConfigError::Endpoint { .. }));
}

#[test]
fn errors_never_show_the_token() {
    let dir = tempfile::tempdir().expect("tempdir");
    // A missing closing quote: the parser would normally quote this line.
    let path = write(
        dir.path(),
        &format!("endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\n"),
        0o600,
    );
    let error = Config::load(&path).expect_err("refused");
    assert!(matches!(error, ConfigError::Invalid { .. }));
    assert!(!error.to_string().contains(TOKEN));
    assert!(!format!("{error:?}").contains(TOKEN));
}
