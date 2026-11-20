use std::sync::Mutex;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _, DuplexStream};
use tokio::sync::{Notify, oneshot};
use uuid::Uuid;

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
    let _stream = FleetTunnel::new(exec.clone())
        .open(COMPUTER, GuestPort::Rfb)
        .await
        .unwrap();

    assert_eq!(
        exec.calls(),
        vec![vec![
            "sh".to_owned(),
            "-c".to_owned(),
            r#"printf 'macro-screen-tunnel-ready %s\n' "$$" && exec socat -t 1 STDIO "TCP:127.0.0.1:$1,nodelay""#
                .to_owned(),
            "sh".to_owned(),
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
    let mut stream = FleetTunnel::new(exec)
        .open(COMPUTER, GuestPort::Rfb)
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

    let Err(error) = FleetTunnel::new(exec).open(COMPUTER, GuestPort::Rfb).await else {
        panic!("the tunnel did not start");
    };
    let TunnelError::Failed(output) = error else {
        panic!("not a failed tunnel: {error:?}");
    };
    assert!(output.starts_with("OCI runtime exec failed"), "{output}");
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
        FleetTunnel::new(exec).open(COMPUTER, GuestPort::Rfb).await,
        Err(TunnelError::Failed(_))
    ));
}

#[tokio::test]
async fn a_tunnel_whose_socat_fails_reads_as_an_error_not_the_end() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let mut stream = FleetTunnel::new(exec)
        .open(COMPUTER, GuestPort::Rfb)
        .await
        .unwrap();
    // socat couldn't connect: no output, exit 1.
    drop(guest);
    exit.send(1).unwrap();

    let mut buffer = [0u8; 16];
    let error = stream.read(&mut buffer).await.unwrap_err();
    assert!(TunnelExited::is(&error), "{error}");
}

#[tokio::test]
async fn a_tunnel_that_exits_cleanly_is_the_port_closing() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest
        .write_all(b"macro-screen-tunnel-ready 4242\nbye")
        .await
        .unwrap();
    let mut stream = FleetTunnel::new(exec.clone())
        .open(COMPUTER, GuestPort::Rfb)
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
    let stream = FleetTunnel::new(exec.clone())
        .open(COMPUTER, GuestPort::Rfb)
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
        &vec!["kill".to_owned(), "4242".to_owned()]
    );
}

#[tokio::test(start_paused = true)]
async fn a_tunnel_whose_exec_ended_but_whose_program_may_not_is_killed_too() {
    let (exec, mut guest, exit) = FakeExec::new();
    guest.write_all(READY).await.unwrap();
    let stream = FleetTunnel::new(exec.clone())
        .open(COMPUTER, GuestPort::Rfb)
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
        &vec!["kill".to_owned(), "4242".to_owned()]
    );
}
