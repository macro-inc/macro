use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;

#[test]
fn exec_attaches_stdin_as_the_macro_user_without_a_tty() {
    assert_eq!(
        exec_args(
            COMPUTER_ID,
            &["harnessd", "--state-dir", "/var/lib/harnessd"]
        ),
        [
            "exec",
            "-i",
            "-u",
            "1000:1000",
            "-w",
            "/home/macro",
            "-e",
            "HOME=/home/macro",
            "-e",
            "PATH=/run/wrappers/bin:/run/current-system/sw/bin",
            "macro-computer-01900000-0000-7000-8000-000000000001",
            "harnessd",
            "--state-dir",
            "/var/lib/harnessd",
        ]
    );
}

#[test]
fn a_vanished_container_is_missing() {
    assert!(
        exec_failure(
            COMPUTER_ID,
            1,
            b"Error response from daemon: No such container: macro-computer-01900000-0000-7000-8000-000000000001\n"
        )
        .is_some_and(|error| error.is_missing())
    );
    assert!(exec_failure(COMPUTER_ID, 3, b"harnessd: bad request\n").is_none());
}

/// Removes the container even when an assertion fails.
struct ExecFixture(String);

impl Drop for ExecFixture {
    fn drop(&mut self) {
        let removed = std::process::Command::new("docker")
            .args(["rm", "--force", &self.0])
            .output();
        if !removed.is_ok_and(|output| output.status.success()) {
            eprintln!("could not remove Docker fixture {}", self.0);
        }
    }
}

#[tokio::test]
#[ignore = "requires a local Docker daemon with busybox:latest"]
async fn exec_streams_stdin_to_stdout_and_reports_the_exit_code() {
    let computer_id = ComputerId::new_from_uuid(Uuid::now_v7());
    let fixture = ExecFixture(container_name(computer_id));
    docker(
        "run",
        &[
            "run".to_owned(),
            "--detach".to_owned(),
            "--name".to_owned(),
            fixture.0.clone(),
            "--label".to_owned(),
            format!("{COMPUTER_ID_LABEL}={computer_id}"),
            "--network".to_owned(),
            "none".to_owned(),
            "busybox:latest".to_owned(),
            "sleep".to_owned(),
            "600".to_owned(),
        ],
    )
    .await
    .unwrap();
    docker(
        "exec",
        &[
            "exec".to_owned(),
            fixture.0.clone(),
            "sh".to_owned(),
            "-c".to_owned(),
            "mkdir -p /home/macro && chown 1000:1000 /home/macro".to_owned(),
        ],
    )
    .await
    .unwrap();
    let fleet = DockerFleet::new(config(), Environment::Local).unwrap();

    // Busybox has no NixOS profile on PATH, so name the programs absolutely.
    let mut cat = fleet.exec(computer_id, &["/bin/cat"]).await.unwrap();
    cat.stdin
        .write_all(b"{\"command\":\"status\",\"agent\":\"claude\"}\n")
        .await
        .unwrap();
    // Closing stdin is dropping it: a pipe has no half-close.
    drop(cat.stdin);
    let mut echoed = String::new();
    cat.stdout.read_to_string(&mut echoed).await.unwrap();
    assert_eq!(echoed, "{\"command\":\"status\",\"agent\":\"claude\"}\n");
    assert_eq!(cat.exit.await.unwrap(), 0);

    let mut identity = fleet
        .exec(
            computer_id,
            &[
                "/bin/sh",
                "-c",
                "echo \"$(/bin/id -u):$(/bin/id -g) $HOME $PWD $PATH\"",
            ],
        )
        .await
        .unwrap();
    drop(identity.stdin);
    let mut printed = String::new();
    identity.stdout.read_to_string(&mut printed).await.unwrap();
    assert_eq!(
        printed,
        "1000:1000 /home/macro /home/macro /run/wrappers/bin:/run/current-system/sw/bin\n"
    );
    assert_eq!(identity.exit.await.unwrap(), 0);

    let failing = fleet
        .exec(computer_id, &["/bin/sh", "-c", "echo oops >&2; exit 3"])
        .await
        .unwrap();
    assert_eq!(failing.exit.await.unwrap(), 3);

    drop(fixture);
    let gone = fleet.exec(computer_id, &["/bin/cat"]).await;
    assert!(gone.is_err_and(|error| error.is_missing()));
}
