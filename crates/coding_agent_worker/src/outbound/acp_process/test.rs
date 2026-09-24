//! Ported from the SDK's `acp_agent.rs` tests so the behaviours this module
//! duplicates stay pinned, plus the working-directory guarantee that is the
//! reason the module exists.

use super::*;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

fn recording_debug_callback() -> (DebugCallback, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let recorded = lines.clone();
    let callback = Arc::new(move |line: &str, direction| {
        assert_eq!(direction, LineDirection::Stderr);
        recorded.lock().unwrap().push(line.to_owned());
    });
    (callback, lines)
}

fn error_detail(error: &Error) -> String {
    error
        .data
        .as_ref()
        .map(serde_json::Value::to_string)
        .unwrap_or_default()
}

#[test]
fn stderr_tail_keeps_last_bytes() {
    let initial = vec![b'a'; STDERR_CAPTURE_LIMIT];

    let mut exact = StderrTail::default();
    exact.push(&initial);
    assert_eq!(exact.into_string(), String::from_utf8(initial).unwrap());

    let mut truncated = StderrTail::default();
    truncated.push(&vec![b'a'; STDERR_CAPTURE_LIMIT]);
    truncated.push(b"the end");
    let captured = truncated.into_string();
    let (notice, tail) = captured.split_once('\n').unwrap();
    assert_eq!(
        notice,
        format!("[stderr truncated; showing last {STDERR_CAPTURE_LIMIT} bytes]")
    );
    assert_eq!(tail.len(), STDERR_CAPTURE_LIMIT);
    assert!(tail.ends_with("the end"));
}

#[test]
fn stderr_debug_callback_preserves_lines() {
    let (callback, recorded) = recording_debug_callback();
    let mut lines = StderrDebugLines::default();

    lines.push(b"one\r", &callback);
    lines.push(b"\n\ntw", &callback);
    lines.push(b"o\nbad\xff\nlast\r", &callback);
    lines.finish(&callback);

    assert_eq!(
        *recorded.lock().unwrap(),
        ["one", "", "two", "bad\u{fffd}", "last\r"]
    );
}

#[test]
fn stderr_debug_callback_truncates_oversized_lines() {
    let (callback, recorded) = recording_debug_callback();
    let mut lines = StderrDebugLines::default();
    let exact = vec![b'y'; STDERR_CAPTURE_LIMIT];
    let oversized = vec![b'x'; STDERR_CAPTURE_LIMIT + 1];

    lines.push(&exact, &callback);
    lines.push(b"\r\n", &callback);
    lines.push(&oversized, &callback);
    assert_eq!(lines.current.len(), STDERR_CAPTURE_LIMIT);
    assert!(lines.truncated);
    lines.push(b"\nnext\n", &callback);

    let recorded = recorded.lock().unwrap();
    assert_eq!(recorded.len(), 3);
    assert_eq!(recorded[0].len(), STDERR_CAPTURE_LIMIT);
    assert!(!recorded[0].ends_with(STDERR_LINE_TRUNCATION_MARKER));
    assert_eq!(
        recorded[1].len(),
        STDERR_CAPTURE_LIMIT + STDERR_LINE_TRUNCATION_MARKER.len()
    );
    assert!(recorded[1].ends_with(STDERR_LINE_TRUNCATION_MARKER));
    assert_eq!(recorded[2], "next");
}

struct ErrorAfterData {
    polls: Arc<AtomicUsize>,
}

impl futures::AsyncRead for ErrorAfterData {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
        buffer: &mut [u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.polls.fetch_add(1, Ordering::SeqCst) {
            0 => {
                buffer[..7].copy_from_slice(b"partial");
                std::task::Poll::Ready(Ok(7))
            }
            1 => std::task::Poll::Ready(Err(std::io::Error::other("read failed"))),
            _ => panic!("stderr reader was polled again after an error"),
        }
    }
}

#[tokio::test]
async fn stderr_drain_stops_after_read_error() {
    let polls = Arc::new(AtomicUsize::new(0));
    let (callback, recorded) = recording_debug_callback();

    let result = drain_stderr(
        ErrorAfterData {
            polls: polls.clone(),
        },
        Some(callback),
    )
    .await;

    assert_eq!(result.captured, "partial");
    assert_eq!(result.read_error.unwrap().to_string(), "read failed");
    assert_eq!(polls.load(Ordering::SeqCst), 2);
    assert_eq!(*recorded.lock().unwrap(), ["partial"]);
}

#[tokio::test]
async fn successful_child_exit_bounds_protocol_shutdown_cleanly() {
    let grace = Duration::from_millis(10);
    tokio::time::timeout(
        Duration::from_secs(1),
        await_protocol_shutdown_after_successful_child_exit(
            futures::future::pending::<Result<(), Error>>(),
            grace,
        ),
    )
    .await
    .expect("protocol shutdown wait should be bounded")
    .expect("a successful child exit should stop the pending protocol cleanly");
}

#[tokio::test]
async fn successful_child_exit_preserves_ready_protocol_error() {
    let error = await_protocol_shutdown_after_successful_child_exit(
        futures::future::ready(Err(internal_error("protocol failed during shutdown"))),
        Duration::from_secs(1),
    )
    .await
    .expect_err("a ready protocol error should remain authoritative");

    assert!(
        error_detail(&error).contains("protocol failed during shutdown"),
        "unexpected protocol error: {error:?}"
    );
}

#[cfg(unix)]
fn shell(script: &str, cwd: impl Into<PathBuf>) -> AcpProcess {
    AcpProcess::new("/bin/sh", vec!["-c".to_owned(), script.to_owned()], cwd)
}

#[cfg(unix)]
#[tokio::test]
async fn child_sees_the_configured_environment() {
    // The npm ACP adapters are pointed at an already-installed CLI through
    // `CODEX_PATH` / `CLAUDE_CODE_EXECUTABLE`; if those do not reach the child
    // the adapter silently runs its own bundled copy instead.
    let process = shell("printf %s \"$MACROD_TEST_CLI_PATH\" >&2; exit 17", "/").envs([(
        "MACROD_TEST_CLI_PATH".to_owned(),
        "/nix/store/probe-and-bridge-agree".to_owned(),
    )]);

    let error = tokio::time::timeout(Duration::from_secs(5), Client.builder().connect_to(process))
        .await
        .expect("connection should finish after the child exits")
        .expect_err("nonzero exit should be reported");

    assert!(
        error_detail(&error).contains("/nix/store/probe-and-bridge-agree"),
        "configured environment should reach the child: {error:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn configured_environment_adds_to_the_inherited_one() {
    // `envs` layers onto this process's environment rather than replacing it:
    // the adapters still need PATH, HOME and the rest to work.
    unsafe { std::env::set_var("MACROD_TEST_INHERITED", "inherited") };
    let process = shell(
        "printf %s \"$MACROD_TEST_INHERITED:$MACROD_TEST_ADDED\" >&2; exit 17",
        "/",
    )
    .envs([("MACROD_TEST_ADDED".to_owned(), "added".to_owned())]);

    let error = tokio::time::timeout(Duration::from_secs(5), Client.builder().connect_to(process))
        .await
        .expect("connection should finish after the child exits")
        .expect_err("nonzero exit should be reported");

    assert!(
        error_detail(&error).contains("inherited:added"),
        "configured environment should add to the inherited one: {error:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn child_runs_in_the_configured_directory() {
    let cwd = tempfile::tempdir().expect("temporary cwd");
    let expected = cwd.path().canonicalize().expect("canonical cwd");
    let process = shell("pwd -P >&2; exit 17", cwd.path());

    let error = tokio::time::timeout(Duration::from_secs(5), Client.builder().connect_to(process))
        .await
        .expect("connection should finish after the child exits")
        .expect_err("nonzero exit should be reported");

    assert!(
        error_detail(&error).contains(&*expected.to_string_lossy()),
        "child should run in the configured directory: {error:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn unspawnable_command_fails_without_touching_the_daemon_directory() {
    let before = std::env::current_dir().expect("daemon cwd");
    let process = shell("exit 0", "/definitely/not/a/directory");

    Client
        .builder()
        .connect_to(process)
        .await
        .expect_err("a missing working directory must fail the spawn");

    assert_eq!(std::env::current_dir().expect("daemon cwd"), before);
}

#[cfg(unix)]
#[tokio::test]
async fn large_unterminated_stderr_is_fully_drained() {
    let process = shell(
        r#"i=0; while [ "$i" -lt 4096 ]; do printf '%01024d' 0; i=$((i + 1)); done >&2; printf ACP_END >&2; exit 17"#,
        "/",
    );
    let SpawnedChild {
        stdin,
        stdout,
        stderr,
        mut guard,
    } = process.spawn().unwrap();
    drop(stdin);
    drop(stdout);

    let (drained, status) = tokio::time::timeout(Duration::from_secs(10), async {
        futures::join!(drain_stderr(stderr.compat(), None), guard.wait())
    })
    .await
    .expect("stderr drain should not block after its retained tail is full");

    assert_eq!(status.unwrap().code(), Some(17));
    assert!(drained.read_error.is_none());
    let (notice, tail) = drained.captured.split_once('\n').unwrap();
    assert_eq!(
        notice,
        format!("[stderr truncated; showing last {STDERR_CAPTURE_LIMIT} bytes]")
    );
    assert_eq!(tail.len(), STDERR_CAPTURE_LIMIT);
    assert!(tail.ends_with("ACP_END"));
}

#[cfg(unix)]
#[tokio::test]
async fn protocol_eof_still_reports_nonzero_child_exit() {
    let process = shell(
        "exec 1>&-; cat >/dev/null; printf ACP_TEST_FAILURE_AFTER_STDOUT_EOF >&2; exit 17",
        "/",
    );

    let error = tokio::time::timeout(Duration::from_secs(5), Client.builder().connect_to(process))
        .await
        .expect("connection should finish after the child exits")
        .expect_err("nonzero child exit after protocol EOF should be reported");
    let detail = error_detail(&error);

    assert!(
        detail.contains("exit status: 17"),
        "child exit status should be preserved: {error:?}"
    );
    assert!(
        detail.contains("ACP_TEST_FAILURE_AFTER_STDOUT_EOF"),
        "child stderr should be preserved: {error:?}"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn successful_child_exit_does_not_cancel_active_foreground() {
    let process = shell("exit 0", "/");
    let (started_tx, started_rx) = futures::channel::oneshot::channel();
    let (closed_tx, closed_rx) = futures::channel::oneshot::channel();
    let (close_release_tx, close_release_rx) = futures::channel::oneshot::channel();
    let (release_tx, release_rx) = futures::channel::oneshot::channel();
    let connection = tokio::spawn(
        Client
            .builder()
            .on_close(async move |_context| {
                closed_tx
                    .send(())
                    .map_err(|()| Error::internal_error().data("close observer dropped"))?;
                close_release_rx
                    .await
                    .map_err(|_| Error::internal_error().data("close callback release dropped"))
            })
            .connect_with(process, async move |_context| {
                started_tx
                    .send(())
                    .map_err(|()| Error::internal_error().data("foreground observer dropped"))?;
                release_rx
                    .await
                    .map_err(|_| Error::internal_error().data("foreground release dropped"))
            }),
    );

    tokio::time::timeout(Duration::from_secs(5), started_rx)
        .await
        .expect("foreground should start")
        .expect("foreground should report that it started");

    tokio::time::timeout(Duration::from_secs(5), closed_rx)
        .await
        .expect("successful child exit should close the protocol transport")
        .expect("successful child exit should invoke close callbacks");

    tokio::time::sleep(SHUTDOWN_GRACE_PERIOD + Duration::from_millis(250)).await;
    assert!(
        !connection.is_finished(),
        "successful child exit canceled active cleanup"
    );

    close_release_tx
        .send(())
        .expect("clean child exit should preserve close callbacks");
    release_tx
        .send(())
        .expect("clean child exit should preserve the foreground");
    tokio::time::timeout(Duration::from_secs(5), connection)
        .await
        .expect("released foreground should finish")
        .expect("connection task should not panic")
        .expect("successful child exit should remain a clean EOF");
}

#[cfg(unix)]
struct KillOnDrop(Option<rustix::process::Pid>);

#[cfg(unix)]
impl KillOnDrop {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

#[cfg(unix)]
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            let _result = rustix::process::kill_process(pid, rustix::process::Signal::KILL);
        }
    }
}

/// A shell wrapper that reports a descendant pid over stderr, the way `npx`
/// fronts the real agent.
#[cfg(unix)]
fn wrapper_process(script: &str) -> (AcpProcess, tokio::sync::mpsc::UnboundedReceiver<String>) {
    let (pid_tx, pid_rx) = tokio::sync::mpsc::unbounded_channel();
    let process = shell(script, "/").with_debug(move |line, direction| {
        if direction == LineDirection::Stderr {
            drop(pid_tx.send(line.to_owned()));
        }
    });
    (process, pid_rx)
}

#[cfg(unix)]
fn process_is_running(pid: rustix::process::Pid) -> bool {
    if rustix::process::test_kill_process(pid).is_err() {
        return false;
    }
    !is_zombie(pid)
}

/// A killed orphan can remain a zombie under a container PID 1 that does not
/// reap promptly, and a zombie still answers `kill(pid, 0)`.
///
/// Read the state from procfs rather than shelling out to `ps`: CI's container
/// answers `ps -o stat= -p` differently from a developer machine, which made
/// live processes look exited.
#[cfg(all(unix, target_os = "linux"))]
fn is_zombie(pid: rustix::process::Pid) -> bool {
    let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    // `<pid> (<comm>) <state> ...`, where `comm` may itself contain spaces and
    // parentheses, so the state is the first field after the final `)`.
    stat.rsplit_once(')')
        .and_then(|(_, rest)| rest.split_whitespace().next())
        .is_some_and(|state| state == "Z")
}

#[cfg(all(unix, not(target_os = "linux")))]
fn is_zombie(_pid: rustix::process::Pid) -> bool {
    false
}

#[cfg(unix)]
async fn reported_descendant_pid(
    connection: &mut futures::future::BoxFuture<'static, Result<(), Error>>,
    pid_rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>,
) -> rustix::process::Pid {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            tokio::select! {
                biased;
                line = pid_rx.recv() => {
                    let line = line.expect("wrapper stderr should remain open");
                    if let Some(pid) = line.strip_prefix("ACP_TEST_CHILD_PID=") {
                        let pid = pid.parse::<i32>().expect("valid descendant PID");
                        break rustix::process::Pid::from_raw(pid)
                            .expect("nonzero descendant PID");
                    }
                }
                result = &mut *connection => {
                    panic!("agent connection exited before reporting descendant PID: {result:?}");
                }
            }
        }
    })
    .await
    .expect("wrapper should report descendant PID")
}

#[cfg(unix)]
async fn assert_process_exits(pid: rustix::process::Pid) {
    let exited = tokio::time::timeout(Duration::from_secs(5), async {
        while process_is_running(pid) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .is_ok();
    assert!(exited, "descendant process {pid} remained alive");
}

#[cfg(unix)]
#[tokio::test]
async fn protocol_eof_terminates_a_child_that_does_not_exit() {
    let (process, mut pid_rx) =
        wrapper_process("echo ACP_TEST_CHILD_PID=$$ >&2; exec 1>&-; while :; do sleep 30; done");
    let mut connection: futures::future::BoxFuture<'static, Result<(), Error>> =
        Box::pin(Client.builder().connect_to(process));
    let child_pid = reported_descendant_pid(&mut connection, &mut pid_rx).await;
    let mut cleanup = KillOnDrop(Some(child_pid));

    assert!(process_is_running(child_pid));
    tokio::time::timeout(Duration::from_secs(5), &mut connection)
        .await
        .expect("protocol shutdown should bound its child-exit wait")
        .expect("clean protocol shutdown should terminate a non-exiting child");
    assert_process_exits(child_pid).await;
    cleanup.disarm();
}

#[cfg(unix)]
#[tokio::test]
async fn protocol_eof_bounds_a_blocked_outgoing_drain() {
    let (process, mut pid_rx) = wrapper_process(
        "echo ACP_TEST_CHILD_PID=$$ >&2; exec 1>&-; sleep 30 & child=$!; wait \"$child\"",
    );
    let (channel, mut connection) = ConnectTo::<Client>::into_channel_and_future(process);
    let agent_client_protocol::Channel {
        rx: _incoming,
        tx: outgoing,
    } = channel;

    let response = agent_client_protocol::RawJsonRpcMessage::response(
        agent_client_protocol::schema::v1::RequestId::Number(1),
        Ok(serde_json::json!({ "payload": "x".repeat(4 * 1024 * 1024) })),
    );
    outgoing
        .unbounded_send(agent_client_protocol::TransportFrame::Single(response))
        .expect("response should be accepted before the connection starts");
    outgoing.close_channel();

    let child_pid = reported_descendant_pid(&mut connection, &mut pid_rx).await;
    let mut cleanup = KillOnDrop(Some(child_pid));

    let error = tokio::time::timeout(Duration::from_secs(5), &mut connection)
        .await
        .expect("stdout EOF should bound a blocked outgoing drain")
        .expect_err("an undelivered accepted response must not report success");
    assert!(
        error_detail(&error).contains("pending protocol output did not drain"),
        "the error should identify the blocked outgoing drain: {error:?}"
    );

    assert_process_exits(child_pid).await;
    cleanup.disarm();
}

#[cfg(unix)]
#[tokio::test]
async fn connection_drop_kills_wrapper_descendant() {
    let (process, mut pid_rx) =
        wrapper_process("sleep 30 & child=$!; echo ACP_TEST_CHILD_PID=$child >&2; wait \"$child\"");
    let (_channel, mut connection) = ConnectTo::<Client>::into_channel_and_future(process);
    let descendant_pid = reported_descendant_pid(&mut connection, &mut pid_rx).await;
    let mut cleanup = KillOnDrop(Some(descendant_pid));

    assert!(process_is_running(descendant_pid));
    drop(connection);
    assert_process_exits(descendant_pid).await;
    cleanup.disarm();
}

#[cfg(unix)]
#[tokio::test]
async fn launcher_exit_kills_descendant_before_stderr_wait() {
    let (process, mut pid_rx) = wrapper_process(
        "sh -c 'trap \"\" HUP; exec sleep 30' >/dev/null & child=$!; echo ACP_TEST_CHILD_PID=$child >&2; exit 17",
    );
    let (_channel, mut connection) = ConnectTo::<Client>::into_channel_and_future(process);
    let descendant_pid = reported_descendant_pid(&mut connection, &mut pid_rx).await;
    let mut cleanup = KillOnDrop(Some(descendant_pid));

    let result = tokio::time::timeout(Duration::from_secs(5), &mut connection)
        .await
        .expect("connection should observe the launcher exit");
    let error = result.expect_err("nonzero launcher exit should be an error");
    assert!(
        error_detail(&error).contains("ACP_TEST_CHILD_PID="),
        "launcher stderr should be preserved: {error:?}"
    );
    assert_process_exits(descendant_pid).await;
    cleanup.disarm();
}
