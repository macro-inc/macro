use std::path::{Path, PathBuf};
use std::time::Duration;

use firecracker_host_api::exec::{Frame, read_frame, write_frame};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;
use tokio::time::Instant;

use super::{GuestLinkError, connect_until, exec, root_request};

const PORT: u32 = 52;
const HANDSHAKE: Duration = Duration::from_millis(100);

/// How a stand-in for Firecracker's hybrid vsock answers one connection.
#[derive(Debug, Clone, Copy)]
enum Answer {
    /// `OK <port>`, then the connection is handed to the test.
    Ok,
    /// Closes, as Firecracker does when nothing listens on the port.
    Close,
    /// Reads the `CONNECT` and never answers.
    Hang,
}

/// A stand-in answering connections in `answers`' order (the last one
/// repeats), reporting each `CONNECT` line it reads and handing over the
/// connections it answered `OK`.
fn firecracker(
    socket: &Path,
    answers: Vec<Answer>,
) -> (
    mpsc::UnboundedReceiver<String>,
    mpsc::UnboundedReceiver<UnixStream>,
) {
    let listener = UnixListener::bind(socket).unwrap();
    let (lines, connect_lines) = mpsc::unbounded_channel();
    let (accepted, accepted_streams) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut held = Vec::new();
        for index in 0.. {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let answer = answers[index.min(answers.len() - 1)];
            let mut line = String::new();
            BufReader::new(&mut stream)
                .read_line(&mut line)
                .await
                .unwrap();
            let _ = lines.send(line.trim_end().to_owned());
            match answer {
                Answer::Ok => {
                    stream.write_all(b"OK 1073741824\n").await.unwrap();
                    let _ = accepted.send(stream);
                }
                Answer::Close => drop(stream),
                Answer::Hang => held.push(stream),
            }
        }
    });
    (connect_lines, accepted_streams)
}

fn socket_in(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("v.sock")
}

#[tokio::test]
async fn a_connect_is_retried_until_the_guest_agent_listens() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (mut lines, mut accepted) =
        firecracker(&socket, vec![Answer::Close, Answer::Close, Answer::Ok]);

    let deadline = Instant::now() + Duration::from_secs(10);
    let stream = connect_until(&socket, PORT, deadline, HANDSHAKE).await;

    assert!(stream.is_ok(), "{stream:?}");
    for _ in 0..3 {
        assert_eq!(lines.recv().await.as_deref(), Some("CONNECT 52"));
    }
    assert!(accepted.recv().await.is_some());
}

#[tokio::test(start_paused = true)]
async fn a_handshake_that_hangs_is_given_up_and_tried_again() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (mut lines, _accepted) = firecracker(&socket, vec![Answer::Hang, Answer::Ok]);

    let started = Instant::now();
    let deadline = started + Duration::from_secs(10);
    let stream = connect_until(&socket, PORT, deadline, HANDSHAKE).await;

    assert!(stream.is_ok(), "{stream:?}");
    assert!(
        started.elapsed() >= HANDSHAKE,
        "the second attempt came before the first one's timeout"
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the hung handshake held the connect"
    );
    assert_eq!(lines.recv().await.as_deref(), Some("CONNECT 52"));
    assert_eq!(lines.recv().await.as_deref(), Some("CONNECT 52"));
}

#[tokio::test(start_paused = true)]
async fn a_guest_that_never_answers_fails_at_the_deadline_with_the_handshake_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (mut lines, _accepted) = firecracker(&socket, vec![Answer::Hang]);

    let started = Instant::now();
    let deadline = started + Duration::from_millis(350);
    let error = connect_until(&socket, PORT, deadline, HANDSHAKE)
        .await
        .unwrap_err();

    assert!(
        matches!(error, GuestLinkError::HandshakeTimedOut(_)),
        "{error:?}"
    );
    assert!(started.elapsed() >= Duration::from_millis(350));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "the last attempt outlived the deadline by more than its timeout"
    );
    let mut attempts = 0;
    while lines.try_recv().is_ok() {
        attempts += 1;
    }
    assert!(
        attempts >= 3,
        "only {attempts} attempts before the deadline"
    );
}

#[tokio::test(start_paused = true)]
async fn each_handshake_timeout_doubles_the_next_attempts_limit() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (_lines, _accepted) = firecracker(&socket, vec![Answer::Hang, Answer::Hang, Answer::Ok]);

    let started = Instant::now();
    let deadline = started + Duration::from_secs(10);
    let stream = connect_until(&socket, PORT, deadline, HANDSHAKE).await;

    assert!(stream.is_ok(), "{stream:?}");
    // 100 ms, a 10 ms pause, 200 ms, a 20 ms pause.
    assert!(
        started.elapsed() >= Duration::from_millis(330),
        "the second attempt was not given twice the first's limit: {:?}",
        started.elapsed()
    );
}

#[tokio::test(start_paused = true)]
async fn a_guest_agent_that_never_listens_fails_with_the_refusal_not_a_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (_lines, _accepted) = firecracker(&socket, vec![Answer::Close]);

    let deadline = Instant::now() + Duration::from_millis(75);
    let error = connect_until(&socket, PORT, deadline, HANDSHAKE)
        .await
        .unwrap_err();

    assert!(matches!(error, GuestLinkError::Refused(_)), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn no_socket_fails_with_connect_at_the_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);

    let deadline = Instant::now() + Duration::from_millis(50);
    let error = connect_until(&socket, PORT, deadline, HANDSHAKE)
        .await
        .unwrap_err();

    assert!(matches!(error, GuestLinkError::Connect { .. }), "{error:?}");
}

#[tokio::test]
async fn an_exec_returns_the_exit_code_and_stdout() {
    let (host, mut guest) = UnixStream::pair().unwrap();
    let guest_side = tokio::spawn(async move {
        let Some(Frame::Start(request)) = read_frame(&mut guest).await.unwrap() else {
            panic!("the first frame was not a start");
        };
        assert_eq!(
            read_frame(&mut guest).await.unwrap(),
            Some(Frame::CloseStdin)
        );
        write_frame(&mut guest, &Frame::Stdout(b"active\n".to_vec()))
            .await
            .unwrap();
        write_frame(&mut guest, &Frame::Exited(3)).await.unwrap();
        request
    });

    let request = root_request(&["systemctl", "is-active", "macrod"], "/bin");
    let deadline = Instant::now() + Duration::from_secs(10);
    let (code, stdout) = exec(host, request, deadline).await.unwrap();

    assert_eq!((code, stdout.as_slice()), (3, b"active\n".as_slice()));
    let request = guest_side.await.unwrap();
    assert_eq!(request.argv, ["systemctl", "is-active", "macrod"]);
    assert_eq!(
        (request.uid, request.gid, request.cwd.as_str()),
        (0, 0, "/")
    );
    assert_eq!(request.env.get("PATH").map(String::as_str), Some("/bin"));
}

#[tokio::test(start_paused = true)]
async fn an_exec_the_guest_never_finishes_times_out_naming_the_program() {
    let (host, mut guest) = UnixStream::pair().unwrap();
    let guest_side =
        tokio::spawn(async move { while read_frame(&mut guest).await.unwrap().is_some() {} });

    let request = root_request(&["sleep", "infinity"], "/bin");
    let deadline = Instant::now() + Duration::from_millis(50);
    let error = exec(host, request, deadline).await.unwrap_err();

    assert!(
        matches!(&error, GuestLinkError::TimedOut(argv) if argv == &["sleep", "infinity"]),
        "{error:?}"
    );
    guest_side.abort();
}

#[tokio::test(start_paused = true)]
async fn a_deadline_already_passed_still_gets_one_short_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_in(&dir);
    let (mut lines, _accepted) = firecracker(&socket, vec![Answer::Hang]);

    let started = Instant::now();
    let error = connect_until(&socket, PORT, started, HANDSHAKE)
        .await
        .unwrap_err();

    assert!(
        matches!(error, GuestLinkError::HandshakeTimedOut(limit) if limit == Duration::from_millis(10)),
        "{error:?}"
    );
    assert_eq!(lines.recv().await.as_deref(), Some("CONNECT 52"));
    assert!(lines.try_recv().is_err(), "more than one attempt");
}

#[tokio::test]
async fn an_exec_the_guest_closes_before_the_exit_is_closed() {
    let (host, mut guest) = UnixStream::pair().unwrap();
    let guest_side = tokio::spawn(async move {
        // The start and the closed stdin, then the guest goes away.
        let _ = read_frame(&mut guest).await.unwrap();
        let _ = read_frame(&mut guest).await.unwrap();
        drop(guest);
    });

    let request = root_request(&["true"], "/bin");
    let deadline = Instant::now() + Duration::from_secs(10);
    let error = exec(host, request, deadline).await.unwrap_err();

    assert!(matches!(error, GuestLinkError::Closed), "{error:?}");
    guest_side.await.unwrap();
}

#[tokio::test]
async fn an_exec_the_guest_cannot_run_is_failed_with_its_reason() {
    let (host, mut guest) = UnixStream::pair().unwrap();
    let guest_side = tokio::spawn(async move {
        let _ = read_frame(&mut guest).await.unwrap();
        write_frame(&mut guest, &Frame::Failed("no such program".to_owned()))
            .await
            .unwrap();
    });

    let request = root_request(&["nope"], "/bin");
    let deadline = Instant::now() + Duration::from_secs(10);
    let error = exec(host, request, deadline).await.unwrap_err();

    assert!(
        matches!(&error, GuestLinkError::Failed(reason) if reason == "no such program"),
        "{error:?}"
    );
    guest_side.await.unwrap();
}

#[test]
fn a_request_made_inside_a_trace_carries_its_trace_id() {
    use opentelemetry::trace::{TraceContextExt as _, TracerProvider as _};
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    use tracing_subscriber::layer::SubscriberExt as _;

    // No exporter: spans get real ids and go nowhere.
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    tracing::subscriber::with_default(subscriber, || {
        let span = tracing::info_span!("firecracker_host.guest_restore");
        let trace_id = span.context().span().span_context().trace_id().to_string();
        let request = span.in_scope(|| root_request(&["true"], "/bin"));
        assert_eq!(request.trace_id, Some(trace_id));

        let outside = root_request(&["true"], "/bin");
        assert_eq!(outside.trace_id, None);
    });
}
