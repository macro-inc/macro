use super::*;

#[test]
fn run_dev_keeps_doppler_database_url_when_shell_has_local_default() {
    assert!(!should_overlay_process_env(
        Mode::Dev,
        "DATABASE_URL",
        "postgres://user:password@localhost:5432/macrodb"
    ));
    assert!(!should_overlay_process_env(
        Mode::Dev,
        "DATABASE_URL",
        "postgres://user:password@postgres:5432/macrodb"
    ));
}

#[test]
fn run_dev_still_allows_non_local_database_overrides() {
    assert!(should_overlay_process_env(
        Mode::Dev,
        "DATABASE_URL",
        "postgres://user:password@dev.example.com:5432/macrodb"
    ));
}

#[test]
fn local_mode_keeps_local_database_override() {
    assert!(should_overlay_process_env(
        Mode::Local,
        "DATABASE_URL",
        "postgres://user:password@localhost:5432/macrodb"
    ));
}
