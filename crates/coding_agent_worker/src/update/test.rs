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

#[cfg(unix)]
#[tokio::test]
async fn a_release_is_checked_with_the_arguments_it_restarts_with() {
    use std::os::unix::fs::PermissionsExt as _;

    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("beta.toml");
    std::fs::write(&config, "").expect("write config");
    let received = directory.path().join("arguments");
    let staged = directory.path().join("macrod");
    std::fs::write(
        &staged,
        format!(
            "#!/bin/sh\necho \"$@\" > '{}'\necho '{}'\n",
            received.display(),
            config.display()
        ),
    )
    .expect("write the staged binary");
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let relaunch = Relaunch {
        arguments: vec!["macrod".into(), "--profile".into(), "beta".into()],
        config,
    };

    check_config(&staged, &relaunch)
        .await
        .expect("a release that serves this config passes");

    assert_eq!(
        std::fs::read_to_string(&received).expect("read arguments"),
        "--profile beta check-config\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_release_that_rejects_the_config_or_serves_another_fails_the_check() {
    use std::os::unix::fs::PermissionsExt as _;

    let directory = tempfile::tempdir().expect("temp dir");
    let config = directory.path().join("macrod.toml");
    std::fs::write(&config, "").expect("write config");
    let elsewhere = directory.path().join("elsewhere.toml");
    std::fs::write(&elsewhere, "").expect("write the other config");
    let relaunch = Relaunch {
        arguments: vec!["macrod".into()],
        config,
    };

    let rejecting = directory.path().join("rejecting");
    std::fs::write(
        &rejecting,
        "#!/bin/sh\necho 'unknown field `identity`' >&2\nexit 1\n",
    )
    .expect("write the rejecting binary");
    std::fs::set_permissions(&rejecting, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let moved = directory.path().join("moved");
    std::fs::write(
        &moved,
        format!("#!/bin/sh\necho '{}'\n", elsewhere.display()),
    )
    .expect("write the moved binary");
    std::fs::set_permissions(&moved, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let rejected = check_config(&rejecting, &relaunch)
        .await
        .expect_err("a release that rejects the config fails");
    let other = check_config(&moved, &relaunch)
        .await
        .expect_err("a release that serves another config fails");

    assert!(matches!(
        rejected,
        UpdateError::ConfigCheck(ConfigCheckFailure::Rejected)
    ));
    assert!(matches!(
        other,
        UpdateError::ConfigCheck(ConfigCheckFailure::OtherConfig)
    ));
}
