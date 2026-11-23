use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use xtask_local_telemetry::{ForwardingError, Paths, Switch};

use super::{Forwarder, export_endpoint, is_instance_network, with_instance};

const TOKEN: &str = "secret-0123456789abcdef0123456789abcdef";

fn settings(dir: &Path, text: &str) -> Paths {
    let path = dir.join("local-telemetry.toml");
    std::fs::write(&path, text).expect("write settings");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).expect("chmod");
    Paths::at(path, dir.join("buffer"))
}

fn on(dir: &Path) -> Paths {
    settings(
        dir,
        &format!(
            "endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\nservices = true\nmachine = \"build-box\"\n"
        ),
    )
}

#[test]
fn reads_the_lgtm_copy_endpoint_from_inspect_output() {
    let env = "GF_AUTH_ANONYMOUS_ENABLED=true\nOTEL_EXPORTER_OTLP_ENDPOINT=http://grafana-forwarder:4318\nPATH=/usr/bin\n";
    assert_eq!(export_endpoint(env), "http://grafana-forwarder:4318");
}

#[test]
fn an_unset_or_empty_copy_endpoint_is_empty() {
    assert_eq!(export_endpoint("GF_AUTH_ANONYMOUS_ENABLED=true\n"), "");
    assert_eq!(export_endpoint("OTEL_EXPORTER_OTLP_ENDPOINT=\n"), "");
    // A per-signal variable is not the switch run_local sets.
    assert_eq!(
        export_endpoint("OTEL_EXPORTER_OTLP_ENDPOINT_TRACES=http://elsewhere\n"),
        ""
    );
}

#[test]
fn a_run_without_the_setting_or_a_forwarder_does_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = Paths::at(dir.path().join("absent.toml"), dir.path().join("buffer"));
    let (forwarder, problem) = Forwarder::from_paths(&missing);
    assert!(forwarder.is_none() && problem.is_none());

    let plain = settings(
        dir.path(),
        &format!("endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\n"),
    );
    let (forwarder, problem) = Forwarder::from_paths(&plain);
    assert!(forwarder.is_none() && problem.is_none());

    // The recorder reports a file it can't read; this stays quiet.
    let unreadable = settings(dir.path(), "services = \"yes\"\n");
    let (forwarder, problem) = Forwarder::from_paths(&unreadable);
    assert!(forwarder.is_none() && problem.is_none());
}

#[test]
fn services_turn_the_forwarder_on() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (forwarder, problem) = Forwarder::from_paths(&on(dir.path()));
    let forwarder = forwarder.expect("on");
    assert!(problem.is_none());
    assert_eq!(forwarder.lgtm_endpoint(), super::FORWARDER_URL);
}

#[test]
fn a_forwarder_left_on_is_turned_off_by_the_settings_or_the_switch() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut paths = on(dir.path());
    std::fs::create_dir_all(paths.forwarder_dir()).expect("mkdir");

    paths.switch = Switch::Off;
    let (forwarder, _) = Forwarder::from_paths(&paths);
    assert_eq!(forwarder.expect("to turn off").lgtm_endpoint(), "");

    let off = settings(
        dir.path(),
        &format!("endpoint = \"https://otlp.example.com\"\ntoken = \"{TOKEN}\"\n"),
    );
    let (forwarder, _) = Forwarder::from_paths(&off);
    assert_eq!(forwarder.expect("to turn off").lgtm_endpoint(), "");
}

#[test]
fn unusable_settings_leave_a_running_forwarder_alone() {
    let dir = tempfile::tempdir().expect("tempdir");
    let paths = settings(
        dir.path(),
        "endpoint = \"https://otlp.example.com\"\nservices = true\n",
    );
    std::fs::create_dir_all(paths.forwarder_dir()).expect("mkdir");
    let (forwarder, problem) = Forwarder::from_paths(&paths);
    assert!(forwarder.is_none());
    assert!(matches!(problem, Some(ForwardingError::NoToken { .. })));

    let typo = settings(dir.path(), "services = tru\n");
    let (forwarder, problem) = Forwarder::from_paths(&typo);
    assert!(forwarder.is_none() && problem.is_none());
}

#[test]
fn instance_networks_are_the_services_networks_of_macro_projects() {
    assert!(is_instance_network("macro_services"));
    assert!(is_instance_network("macro-channels-b_services"));
    assert!(!is_instance_network("macro-channels-b_auth-internal"));
    assert!(!is_instance_network("bridge"));
    assert!(!is_instance_network("other_services"));
}

#[test]
fn the_instance_is_added_to_existing_resource_attributes() {
    assert_eq!(with_instance(None, "ltg"), "macro.local.instance=ltg");
    assert_eq!(with_instance(Some(" "), "ltg"), "macro.local.instance=ltg");
    assert_eq!(
        with_instance(Some("service.namespace=macro"), "ltg"),
        "service.namespace=macro,macro.local.instance=ltg"
    );
}
