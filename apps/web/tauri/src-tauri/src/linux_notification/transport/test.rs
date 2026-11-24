use super::*;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use zbus::{connection::Builder, object_server::SignalEmitter, zvariant::OwnedValue};

#[derive(Default)]
struct Calls {
    actions: Vec<String>,
    bodies: Vec<String>,
    closed: Vec<u32>,
    close_error: Option<CloseError>,
}

#[derive(Clone, Debug, zbus::DBusError)]
#[zbus(prefix = "org.freedesktop.Notifications.Error")]
enum CloseError {
    NotFound(String),
    Failed(String),
}

struct Daemon {
    calls: Arc<Mutex<Calls>>,
    early_click: bool,
    fail: bool,
}

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl Daemon {
    #[expect(
        clippy::too_many_arguments,
        reason = "freedesktop Notify wire signature"
    )]
    async fn notify(
        &self,
        app: &str,
        replaces: u32,
        _icon: &str,
        _summary: &str,
        body: &str,
        actions: Vec<String>,
        hints: HashMap<String, OwnedValue>,
        timeout: i32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> zbus::fdo::Result<u32> {
        if self.fail {
            return Err(zbus::fdo::Error::Failed("Delivery rejected".into()));
        }
        assert_eq!(app, "Macro");
        assert_eq!(replaces, 0);
        assert_eq!(timeout, -1);
        assert!(hints.contains_key("desktop-entry"));
        let id = {
            let mut calls = self.calls.lock().unwrap();
            calls.actions = actions;
            calls.bodies.push(body.to_owned());
            calls.bodies.len() as u32
        };
        if self.early_click {
            emitter
                .emit(SERVICE, "ActivationToken", &(id, "early-token"))
                .await?;
            emitter
                .emit(SERVICE, "ActionInvoked", &(id, DEFAULT_ACTION))
                .await?;
        }
        Ok(id)
    }

    fn close_notification(&self, id: u32) -> Result<(), CloseError> {
        let mut calls = self.calls.lock().unwrap();
        calls.closed.push(id);
        match calls.close_error.clone() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

struct Bus(Child);
impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// A private session bus's configuration. `dbus-daemon --session` reads
/// `/etc/dbus-1/session.conf`, which minimal machines and CI runners lack, so
/// each bus gets this instead: the standard session policy, without the host's
/// service files and includes.
const BUS_CONFIG: &str = r#"<busconfig>
  <type>session</type>
  <listen>unix:tmpdir=/tmp</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#;

/// Tells apart the configuration files of the buses tests start at once.
static NEXT_BUS: AtomicUsize = AtomicUsize::new(0);

async fn setup(early_click: bool, fail: bool) -> (Bus, Connection, Connection, Arc<Mutex<Calls>>) {
    // Never claim the developer's real notification service or display popups.
    let config = std::env::temp_dir().join(format!(
        "macro-notification-test-bus-{}-{}.conf",
        std::process::id(),
        NEXT_BUS.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&config, BUS_CONFIG).unwrap();
    // Wrapped at once, so a failed setup below still stops the daemon.
    let mut bus = Bus(Command::new("dbus-daemon")
        .arg("--nofork")
        .arg("--print-address=1")
        .arg(format!("--config-file={}", config.display()))
        .stdout(Stdio::piped())
        .spawn()
        .expect("dbus-daemon from the tauri-linux shell"));
    // The daemon prints its address once it has read the configuration.
    let mut address = String::new();
    BufReader::new(bus.0.stdout.take().unwrap())
        .read_line(&mut address)
        .unwrap();
    std::fs::remove_file(&config).unwrap();
    let calls = Arc::new(Mutex::new(Calls::default()));
    let server = Builder::address(address.trim())
        .unwrap()
        .name(SERVICE)
        .unwrap()
        .serve_at(
            PATH,
            Daemon {
                calls: calls.clone(),
                early_click,
                fail,
            },
        )
        .unwrap()
        .build()
        .await
        .unwrap();
    let client = Builder::address(address.trim())
        .unwrap()
        .build()
        .await
        .unwrap();
    (bus, server, client, calls)
}

async fn show(client: Connection) -> Notification {
    Notification::show(
        client,
        "com.macro.app.e2e",
        "Test",
        Some("<hello> & goodbye"),
        None,
    )
    .await
    .unwrap()
}

async fn signal(server: &Connection, name: &str, body: &(u32, &str)) {
    server
        .emit_signal(None::<&str>, PATH, SERVICE, name, body)
        .await
        .unwrap();
}

async fn outcome(notification: Notification, close: oneshot::Receiver<()>) -> Outcome {
    tokio::time::timeout(Duration::from_secs(3), notification.wait(close))
        .await
        .expect("notification listener timed out")
        .unwrap()
}

#[tokio::test]
async fn advertises_default_action_and_buffers_early_token_and_click() {
    let (_bus, _server, client, calls) = setup(true, false).await;
    let notification = show(client).await;
    let (_close, closed) = oneshot::channel();
    assert_eq!(
        outcome(notification, closed).await,
        Outcome::Activated(Some("early-token".into()))
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.actions, ["default", "Open"]);
    assert_eq!(calls.bodies, ["&lt;hello&gt; &amp; goodbye"]);
    assert_eq!(calls.closed, [1]);
}

#[tokio::test]
async fn closing_an_already_removed_notification_succeeds() {
    let (_bus, _server, client, calls) = setup(false, false).await;
    let notification = show(client).await;
    calls.lock().unwrap().close_error =
        Some(CloseError::NotFound("notification id was not found".into()));
    notification.close().await.unwrap();
    assert_eq!(calls.lock().unwrap().closed, [1]);
}

#[tokio::test]
async fn daemon_removal_on_click_does_not_prevent_activation() {
    let (_bus, _server, client, calls) = setup(true, false).await;
    let notification = show(client).await;
    calls.lock().unwrap().close_error =
        Some(CloseError::NotFound("notification id was not found".into()));
    let (_close, closed) = oneshot::channel();
    assert_eq!(
        outcome(notification, closed).await,
        Outcome::Activated(Some("early-token".into()))
    );
    assert_eq!(calls.lock().unwrap().closed, [1]);
}

#[tokio::test]
async fn other_close_errors_are_not_suppressed_even_with_the_same_description() {
    let (_bus, _server, client, calls) = setup(false, false).await;
    let notification = show(client).await;
    calls.lock().unwrap().close_error =
        Some(CloseError::Failed("notification id was not found".into()));
    let error = notification.close().await.unwrap_err();
    assert!(matches!(error, zbus::Error::MethodError(name, _, _)
        if name.as_str() == "org.freedesktop.Notifications.Error.Failed"));
}

#[tokio::test]
async fn simultaneous_notifications_keep_their_tokens_and_actions_separate() {
    let (_bus, server, client, calls) = setup(false, false).await;
    let first = show(client.clone()).await;
    let second = show(client).await;
    signal(&server, "ActivationToken", &(2, "second-token")).await;
    signal(&server, "ActionInvoked", &(1, "unknown-action")).await;
    signal(&server, "ActionInvoked", &(2, DEFAULT_ACTION)).await;
    signal(&server, "ActionInvoked", &(1, DEFAULT_ACTION)).await;
    let (_close1, closed1) = oneshot::channel();
    let (_close2, closed2) = oneshot::channel();
    assert_eq!(outcome(first, closed1).await, Outcome::Activated(None));
    assert_eq!(
        outcome(second, closed2).await,
        Outcome::Activated(Some("second-token".into()))
    );
    assert_eq!(calls.lock().unwrap().closed, [1, 2]);
}

#[tokio::test]
async fn expiry_and_dismissal_never_activate() {
    for reason in [1u32, 2, 3, 4] {
        let (_bus, server, client, calls) = setup(false, false).await;
        let notification = show(client).await;
        server
            .emit_signal(
                None::<&str>,
                PATH,
                SERVICE,
                "NotificationClosed",
                &(1u32, reason),
            )
            .await
            .unwrap();
        let (_close, closed) = oneshot::channel();
        assert_eq!(outcome(notification, closed).await, Outcome::Dismissed);
        assert!(calls.lock().unwrap().closed.is_empty());
    }
}

#[tokio::test]
async fn explicit_close_and_window_destruction_close_the_native_notification() {
    for send in [true, false] {
        let (_bus, _server, client, calls) = setup(false, false).await;
        let notification = show(client).await;
        let (close, closed) = oneshot::channel();
        if send {
            close.send(()).unwrap();
        } else {
            drop(close);
        }
        assert_eq!(outcome(notification, closed).await, Outcome::Dismissed);
        assert_eq!(calls.lock().unwrap().closed, [1]);
    }
}

#[tokio::test]
async fn ignores_signals_from_other_bus_clients() {
    let (_bus, server, client, _) = setup(false, false).await;
    let notification = show(client.clone()).await;
    signal(&client, "ActivationToken", &(1, "wrong-sender")).await;
    signal(&client, "ActionInvoked", &(1, DEFAULT_ACTION)).await;
    signal(&server, "ActionInvoked", &(1, DEFAULT_ACTION)).await;
    let (_close, closed) = oneshot::channel();
    assert_eq!(
        outcome(notification, closed).await,
        Outcome::Activated(None)
    );
}

#[tokio::test]
async fn daemon_exit_releases_pending_notifications_without_activation() {
    let (_bus, server, client, _) = setup(false, false).await;
    let notification = show(client).await;
    server.close().await.unwrap();
    let (_close, closed) = oneshot::channel();
    assert_eq!(outcome(notification, closed).await, Outcome::Dismissed);
}

#[tokio::test]
async fn delivery_errors_reach_the_caller() {
    let (_bus, _server, client, _) = setup(false, true).await;
    let result = Notification::show(client, "com.macro.app.e2e", "Test", None, None).await;
    assert!(
        result
            .err()
            .unwrap()
            .to_string()
            .contains("Delivery rejected")
    );
}
