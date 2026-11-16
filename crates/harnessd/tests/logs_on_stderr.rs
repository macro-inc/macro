//! stdout carries harnessd's JSONL answers, so its logs must go to stderr.

use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Stdio};

#[test]
fn the_daemon_logs_to_stderr_and_leaves_stdout_empty() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let socket = directory.path().join("harnessd.sock");

    let mut daemon = Command::new(env!("CARGO_BIN_EXE_harnessd"))
        .arg("--socket")
        .arg(&socket)
        .arg("serve")
        .arg("--state-dir")
        .arg(directory.path().join("state"))
        .env("RUST_LOG", "trace")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let mut stderr = BufReader::new(daemon.stderr.take().unwrap());
    let mut line = String::new();
    while !line.contains("harnessd listening") {
        line.clear();
        assert_ne!(
            stderr.read_line(&mut line).unwrap(),
            0,
            "harnessd exited before listening"
        );
    }
    daemon.kill().unwrap();
    daemon.wait().unwrap();

    let mut stdout = String::new();
    daemon
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut stdout)
        .unwrap();
    assert_eq!(stdout, "");
}
