use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::{Forwarding, ForwardingError, MachineName, write_private};
use crate::config::{ConfigError, Paths, Switch};

const TOKEN: &str = "secret-0123456789abcdef0123456789abcdef";

fn settings(dir: &Path, text: &str) -> Paths {
    let path = dir.join("local-telemetry.toml");
    std::fs::write(&path, text).expect("write settings");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).expect("chmod");
    Paths::at(path, dir.join("buffer"))
}

fn mode(path: &Path) -> u32 {
    std::fs::metadata(path)
        .expect("metadata")
        .permissions()
        .mode()
        & 0o777
}

#[test]
fn off_unless_the_settings_ask_for_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = Paths::at(dir.path().join("absent.toml"), dir.path().join("buffer"));
    assert!(Forwarding::load(&missing).expect("load").is_none());

    let plain = settings(
        dir.path(),
        &format!("endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\n"),
    );
    assert!(Forwarding::load(&plain).expect("load").is_none());

    let disabled = settings(dir.path(), "enabled = false\nservices = true\n");
    assert!(Forwarding::load(&disabled).expect("load").is_none());
}

#[test]
fn services_forward_to_the_endpoint_under_the_machine_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut paths = settings(
        dir.path(),
        &format!(
            "endpoint = \"https://otlp.example.com/\"\ntoken = \"{TOKEN}\"\nservices = true\nmachine = \"build-box\"\n"
        ),
    );
    let forwarding = Forwarding::load(&paths).expect("load").expect("on");
    assert_eq!(forwarding.endpoint(), "https://otlp.example.com");
    assert_eq!(forwarding.machine().as_str(), "build-box");
    assert!(!format!("{forwarding:?}").contains(TOKEN));

    paths.switch = Switch::Off;
    assert!(Forwarding::load(&paths).expect("load").is_none());
}

#[test]
fn services_need_a_token() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = settings(
        dir.path(),
        "endpoint = \"https://otlp.example.com\"\nservices = true\nmachine = \"build-box\"\n",
    );
    let error = Forwarding::load(&paths).expect_err("refused");
    assert!(matches!(error, ForwardingError::NoToken { .. }));
}

#[test]
fn a_machine_name_is_one_plain_label() {
    assert!(MachineName::parse("solaris").is_some());
    assert!(MachineName::parse("build_box-2").is_some());
    assert!(MachineName::parse("").is_none());
    assert!(MachineName::parse("solaris.internal").is_none());
    assert!(MachineName::parse("two words").is_none());
    assert!(MachineName::parse(&"a".repeat(64)).is_none());

    let dir = tempfile::tempdir().expect("tempdir");
    let paths = settings(
        dir.path(),
        &format!(
            "endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\nservices = true\nmachine = \"a b\"\n"
        ),
    );
    let error = Forwarding::load(&paths).expect_err("refused");
    assert!(matches!(
        error,
        ForwardingError::Config(ConfigError::Machine { .. })
    ));
}

#[test]
fn the_token_file_is_private_and_replaced_whole() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = settings(
        dir.path(),
        &format!(
            "endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\nservices = true\nmachine = \"build-box\"\n"
        ),
    );
    let forwarding = Forwarding::load(&paths).expect("load").expect("on");
    let token = paths.forwarder_dir().join("token");
    std::fs::create_dir_all(paths.forwarder_dir()).expect("mkdir");
    std::fs::set_permissions(
        paths.forwarder_dir(),
        std::fs::Permissions::from_mode(0o755),
    )
    .expect("chmod");
    std::fs::write(&token, "an old token").expect("write");

    forwarding.write_token(&token).expect("write token");
    assert_eq!(std::fs::read_to_string(&token).expect("read"), TOKEN);
    assert_eq!(mode(&token), 0o600);
    assert_eq!(mode(&paths.forwarder_dir()), 0o700);
    let leftovers = std::fs::read_dir(paths.forwarder_dir())
        .expect("read dir")
        .count();
    assert_eq!(leftovers, 1, "no staging file is left behind");

    write_private(&paths.forwarder_dir().join("config.alloy"), b"// config").expect("write");
    assert_eq!(mode(&paths.forwarder_dir().join("config.alloy")), 0o600);
}
