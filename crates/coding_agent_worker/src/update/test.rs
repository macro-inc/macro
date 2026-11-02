use super::*;

#[test]
fn only_release_builds_update() {
    assert!(updates_enabled(Some("v2026.10.28.1"), true, None));
    assert!(!updates_enabled(None, true, None));
    assert!(!updates_enabled(
        Some("wolf/macrod-self-update"),
        true,
        None
    ));
}

#[test]
fn the_config_and_the_environment_each_turn_updates_off() {
    assert!(!updates_enabled(Some("v2026.10.28.1"), false, None));
    for value in ["1", "true", "yes"] {
        assert!(
            !updates_enabled(Some("v2026.10.28.1"), true, Some(value)),
            "{value}"
        );
    }
    for value in ["", "0", "false", "FALSE"] {
        assert!(
            updates_enabled(Some("v2026.10.28.1"), true, Some(value)),
            "{value:?}"
        );
    }
}
