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
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn two_macrods_running_one_executable_update_it_at_the_same_time() {
    use std::os::unix::fs::PermissionsExt as _;

    use install::test::{archive_with, checksum_file};

    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("macrod");
    std::fs::write(&executable, b"#!/bin/sh\necho 'macrod v2026.10.27.1'\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let archive = archive_with("macrod", b"#!/bin/sh\necho 'macrod v2026.10.27.2'\n");
    let checksum = checksum_file(&archive, "macrod.tar.gz");
    // Both stage, then both swap, at once.
    let together = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let update = |process| {
        let installation = Installation::at(executable.clone(), process);
        let (archive, checksum, together) = (archive.clone(), checksum.clone(), together.clone());
        tokio::spawn(async move {
            together.wait().await;
            let staged = installation
                .stage(&archive, &checksum, "v2026.10.27.2")
                .unwrap();
            run_version(&staged).await.unwrap();
            together.wait().await;
            StagedUpdate {
                tag: "v2026.10.27.2".to_owned(),
                version: ReleaseVersion::parse("v2026.10.27.2").unwrap(),
                staged,
                installation,
            }
            .swap()
            .await
            .unwrap()
        })
    };

    let (first, second) = (update(1001), update(1002));
    let (first, second) = (first.await.unwrap(), second.await.unwrap());

    for installed in [first, second] {
        assert_eq!(installed.executable, executable);
        assert_eq!(installed.tag, "v2026.10.27.2");
    }
    assert_eq!(
        run_version(&executable).await.unwrap(),
        "macrod v2026.10.27.2\n"
    );
    let mut left = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    left.sort();
    assert_eq!(left, [".macrod.update.lock", "macrod"]);
}

#[cfg(unix)]
#[tokio::test]
async fn a_macrod_with_an_older_release_staged_restarts_into_the_newer_one_installed() {
    use std::os::unix::fs::PermissionsExt as _;

    use install::test::{archive_with, checksum_file};

    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("macrod");
    // Another macrod installed v2026.10.27.3 while this one waited to swap.
    std::fs::write(&executable, b"#!/bin/sh\necho 'macrod v2026.10.27.3'\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let installation = Installation::at(executable.clone(), 1001);
    let archive = archive_with("macrod", b"#!/bin/sh\necho 'macrod v2026.10.27.2'\n");
    let staged = installation
        .stage(
            &archive,
            &checksum_file(&archive, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap();

    let installed = StagedUpdate {
        tag: "v2026.10.27.2".to_owned(),
        version: ReleaseVersion::parse("v2026.10.27.2").unwrap(),
        staged: staged.clone(),
        installation,
    }
    .swap()
    .await
    .unwrap();

    assert_eq!(installed.tag, "v2026.10.27.3");
    assert!(!staged.exists());
    assert_eq!(
        run_version(&executable).await.unwrap(),
        "macrod v2026.10.27.3\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_macrod_starting_up_keeps_the_update_another_is_waiting_to_swap_in() {
    use std::os::unix::fs::PermissionsExt as _;

    use install::test::{archive_with, checksum_file};

    let directory = tempfile::tempdir().unwrap();
    let executable = directory.path().join("macrod");
    std::fs::write(&executable, b"#!/bin/sh\necho 'macrod v2026.10.27.1'\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    // This test process stands in for the running macrod that staged it.
    let waiting = Installation::at(executable.clone(), std::process::id());
    let archive = archive_with("macrod", b"#!/bin/sh\necho 'macrod v2026.10.27.2'\n");
    let staged = waiting
        .stage(
            &archive,
            &checksum_file(&archive, "macrod.tar.gz"),
            "v2026.10.27.2",
        )
        .unwrap();

    Installation::at(executable.clone(), 1002).remove_leftovers();
    let installed = StagedUpdate {
        tag: "v2026.10.27.2".to_owned(),
        version: ReleaseVersion::parse("v2026.10.27.2").unwrap(),
        staged,
        installation: waiting,
    }
    .swap()
    .await
    .unwrap();

    assert_eq!(installed.tag, "v2026.10.27.2");
    assert_eq!(
        run_version(&executable).await.unwrap(),
        "macrod v2026.10.27.2\n"
    );
}
