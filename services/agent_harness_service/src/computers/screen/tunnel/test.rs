use std::sync::Mutex;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _, DuplexStream};
use tokio::sync::{Notify, oneshot};
use uuid::Uuid;

use tokio_util::task::TaskTracker;

use super::*;

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(0xC0));
const READY: &[u8] = b"macro-screen-tunnel-ready 4242\n";

/// A fleet whose first program is the tunnel (what it prints, how it
/// exits); every later one (a kill) exits at once. It records each argv.
struct FakeExec {
    tunnel: Mutex<Option<(DuplexStream, oneshot::Receiver<i32>)>>,
    calls: Mutex<Vec<Vec<String>>>,
    called: Notify,
}

impl FakeExec {
    fn new() -> (Arc<Self>, DuplexStream, oneshot::Sender<i32>) {
        let (stdout, guest) = tokio::io::duplex(64 * 1024);
        let (exit, exited) = oneshot::channel();
        let exec = Arc::new(Self {
            tunnel: Mutex::new(Some((stdout, exited))),
            calls: Mutex::new(Vec::new()),
            called: Notify::new(),
        });
        (exec, guest, exit)
    }

    fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }
}

impl GuestExec for FakeExec {
    fn exec<'a>(
        &'a self,
        _computer: ComputerId,
        argv: &'a [&'a str],
    ) -> Pin<Box<dyn Future<Output = Result<GuestProgram, TunnelError>> + Send + 'a>> {
        self.calls
            .lock()
            .unwrap()
            .push(argv.iter().map(|arg| (*arg).to_owned()).collect());
        self.called.notify_waiters();
        let tunnel = self.tunnel.lock().unwrap().take();
        Box::pin(async move {
            let Some((stdout, exited)) = tunnel else {
                // A kill: nothing to say, done at once.
                return Ok(GuestProgram {
                    stdin: Box::pin(tokio::io::sink()),
                    stdout: Box::pin(tokio::io::empty()),
                    exit: Box::pin(async { Ok(0) }),
                });
            };
            let (reader, writer) = tokio::io::split(stdout);
            Ok(GuestProgram {
                stdin: Box::pin(writer),
                stdout: Box::pin(reader),
                exit: Box::pin(async move { exited.await.map_err(|error| error.to_string()) }),
            })
        })
    }
}

#[tokio::test]
async fn the_tunnel_runs_socat_to_the_port_with_nodelay() {
    let (exec, mut guest, _exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let _stream = FleetTunnel::new(exec.clone(), TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();

    assert_eq!(
        exec.calls(),
        vec![vec![
            "bash".to_owned(),
            "-c".to_owned(),
            TUNNEL_SCRIPT.to_owned(),
            "bash".to_owned(),
            "5901".to_owned(),
        ]]
    );
}

#[tokio::test]
async fn only_what_follows_the_ready_line_is_media() {
    let (exec, mut guest, _exit) = FakeExec::new();
    guest
        .write_all(b"macro-screen-tunnel-ready 4242\nRFB 003.008\n")
        .await
        .unwrap();
    let mut stream = FleetTunnel::new(exec, TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();

    let mut version = [0u8; 12];
    stream.read_exact(&mut version).await.unwrap();
    assert_eq!(&version, b"RFB 003.008\n");
}

#[tokio::test]
async fn a_fleet_error_instead_of_the_ready_line_is_never_media() {
    let (exec, mut guest, _exit) = FakeExec::new();
    guest
        .write_all(b"OCI runtime exec failed: exec failed: unable to start container process: exec: \"sh\": executable file not found in $PATH: unknown\n")
        .await
        .unwrap();
    drop(guest);

    let Err(error) = FleetTunnel::new(exec, TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
    else {
        panic!("the tunnel did not start");
    };
    assert!(matches!(error, TunnelError::MissingMarker));
}

#[tokio::test]
async fn a_ready_line_without_a_pid_is_refused() {
    let (exec, mut guest, _exit) = FakeExec::new();
    guest
        .write_all(b"macro-screen-tunnel-ready \n")
        .await
        .unwrap();
    drop(guest);

    assert!(matches!(
        FleetTunnel::new(exec, TaskTracker::new())
            .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
            .await,
        Err(TunnelError::MissingMarker)
    ));
}

#[tokio::test]
async fn a_tunnel_whose_socat_fails_reads_as_an_error_not_the_end() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let mut stream = FleetTunnel::new(exec, TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();
    // socat couldn't connect: no output, exit 1.
    drop(guest);
    exit.send(1).unwrap();

    let mut buffer = [0u8; 16];
    let error = stream.read(&mut buffer).await.unwrap_err();
    assert!(matches!(
        TunnelExited::from_io(&error),
        Some(TunnelExited::Code(1))
    ));
}

#[tokio::test]
async fn a_tunnel_that_exits_cleanly_is_the_port_closing() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest
        .write_all(b"macro-screen-tunnel-ready 4242\nbye")
        .await
        .unwrap();
    let mut stream = FleetTunnel::new(exec.clone(), TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();
    drop(guest);
    exit.send(0).unwrap();

    let mut rest = Vec::new();
    stream.read_to_end(&mut rest).await.unwrap();
    assert_eq!(rest, b"bye");
    drop(stream);
    // It ended on its own: nothing to kill.
    assert_eq!(exec.calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_closed_session_whose_tunnel_lingers_kills_it() {
    let (exec, mut guest, _exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let stream = FleetTunnel::new(exec.clone(), TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();
    let called = exec.called.notified();
    tokio::pin!(called);
    called.as_mut().enable();

    // The session ends; the fleet never passes the closed stdin on, so the
    // guest's socat would run forever.
    drop(stream);
    called.await;

    assert_eq!(
        exec.calls().last().unwrap(),
        &vec![
            "sh".to_owned(),
            "-c".to_owned(),
            KILL_SCRIPT.to_owned(),
            "sh".to_owned(),
            "4242".to_owned(),
            "5901".to_owned(),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_tunnel_whose_exec_ended_but_whose_program_may_not_is_killed_too() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let stream = FleetTunnel::new(exec.clone(), TaskTracker::new())
        .open(COMPUTER, GuestPort::Rfb, TunnelRole::Relay)
        .await
        .unwrap();
    let called = exec.called.notified();
    tokio::pin!(called);
    called.as_mut().enable();

    // Docker's client exits once its stdin closes, leaving the guest's
    // socat running: the exec's end proves nothing.
    drop(stream);
    exit.send(0).unwrap();
    called.await;

    assert_eq!(
        exec.calls().last().unwrap(),
        &vec![
            "sh".to_owned(),
            "-c".to_owned(),
            KILL_SCRIPT.to_owned(),
            "sh".to_owned(),
            "4242".to_owned(),
            "5901".to_owned(),
        ]
    );
}

/// An injector connect given up while the guest was still starting its
/// tunnel (the drive ended) leaves that tunnel to start and be reaped,
/// rather than drop its program before anything could end it.
#[tokio::test(start_paused = true)]
async fn a_connect_given_up_before_the_tunnel_started_still_ends_it() {
    let (exec, mut guest, _exit) = FakeExec::new();
    let tunnel: Arc<dyn GuestTunnel> = Arc::new(FleetTunnel::new(exec.clone(), TaskTracker::new()));
    let called = exec.called.notified();
    tokio::pin!(called);
    called.as_mut().enable();

    let given_up = tokio::time::timeout(
        Duration::from_secs(1),
        super::super::socket::connect_injector(tunnel, COMPUTER),
    )
    .await;
    assert!(given_up.is_err());
    // The tunnel's exec ran; its ready line comes only now.
    called.as_mut().await;
    let killed = exec.called.notified();
    tokio::pin!(killed);
    killed.as_mut().enable();
    guest.write_all(READY).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), killed)
        .await
        .expect("the tunnel the connect gave up on was never ended");

    assert_eq!(
        exec.calls().last().unwrap(),
        &vec![
            "sh".to_owned(),
            "-c".to_owned(),
            KILL_SCRIPT.to_owned(),
            "sh".to_owned(),
            "4242".to_owned(),
            "5901".to_owned(),
        ]
    );
}

#[test]
fn the_kill_spares_a_pid_the_guest_gave_another_program() {
    // A program that took the tunnel's pid after it exited: not socat to
    // the tunnel's port, so the kill leaves it alone.
    let mut other = std::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .unwrap();
    let pid = other.id().to_string();

    let status = std::process::Command::new("sh")
        .args(["-c", KILL_SCRIPT, "sh", pid.as_str(), "5901"])
        .status()
        .unwrap();

    assert!(!status.success());
    assert!(
        other.try_wait().unwrap().is_none(),
        "the other program was killed"
    );
    other.kill().unwrap();
    other.wait().unwrap();
}

#[tokio::test]
async fn the_relay_records_where_the_guest_stream_ended() {
    use super::super::media::{DrivingUntil, MediaContext, ScreenMedia, ToViewer, VncMedia};
    use super::super::telemetry::{CloseReason, RelayOutcome, RelayProgress};
    use tokio::sync::{mpsc, watch};

    let spans = crate::test_spans::exported_spans();
    for (stdout, code, stage, reason, relayed) in [
        (&b"exec failed\n"[..], 1, "fleet_exec", "exec_failed", false),
        (&READY[..], 127, "shell_marker", "helper_missing", false),
        (&READY[..], 111, "shell_marker", "connect_refused", false),
        (
            &b"macro-screen-tunnel-ready 4242\n\x00nvalid RFB\n"[..],
            0,
            "first_guest_byte",
            "parser_error",
            false,
        ),
        (
            &b"macro-screen-tunnel-ready 4242\nRFB 003.008\n"[..],
            0,
            "rfb_gate",
            "eof",
            true,
        ),
    ] {
        let (exec, mut guest, exit) = FakeExec::new();
        guest.write_all(stdout).await.unwrap();
        drop(guest);
        exit.send(code).unwrap();

        let span = tracing::info_span!(
            "test.screen.relay",
            fixture = reason,
            screen.relay.stage = tracing::field::Empty,
            screen.relay.close_reason = tracing::field::Empty,
        );
        let (to_viewer, mut viewer) = mpsc::channel(1);
        let (_input, from_viewer) = mpsc::channel(1);
        let (_lease, driving) = watch::channel(DrivingUntil::default());
        let progress = Arc::new(RelayProgress::new(span.clone()));
        let tasks = TaskTracker::new();
        let run = VncMedia.run(MediaContext {
            computer_id: COMPUTER,
            tunnel: Arc::new(FleetTunnel::new(exec, tasks.clone())),
            to_viewer,
            from_viewer,
            driving,
            activity: Arc::new(Notify::new()),
            progress: Arc::clone(&progress),
        });

        let result = run.instrument(span).await;
        {
            let _outcome = RelayOutcome {
                progress: &progress,
                reason: CloseReason::from(&result),
            };
        }
        drop(progress);
        tasks.close();
        tasks.wait().await;

        if relayed {
            let Some(ToViewer::Binary(bytes)) = viewer.recv().await else {
                panic!("the guest's RFB version never reached the viewer");
            };
            assert_eq!(&bytes[..], b"RFB 003.008\n");
        }
        assert!(viewer.recv().await.is_none());

        let exported = spans.exporter.get_finished_spans().unwrap();
        let matching: Vec<_> = exported
            .iter()
            .filter(|span| {
                span.name == "test.screen.relay"
                    && span
                        .attributes
                        .iter()
                        .any(|attr| attr.key.as_str() == "fixture" && attr.value.as_str() == reason)
            })
            .collect();
        assert_eq!(matching.len(), 1);
        for (key, value) in [
            ("screen.relay.stage", stage),
            ("screen.relay.close_reason", reason),
        ] {
            let fields: Vec<_> = matching[0]
                .attributes
                .iter()
                .filter(|attr| attr.key.as_str() == key)
                .map(|attr| attr.value.as_str())
                .collect();
            assert_eq!(fields, [value]);
        }
    }
}
