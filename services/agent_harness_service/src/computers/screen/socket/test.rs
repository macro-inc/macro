use std::convert::Infallible;

use super::*;

#[tokio::test(start_paused = true)]
async fn an_awake_computer_is_not_announced_as_waking() {
    let mut told = false;
    let (woken, notice) = noticed_after(async { Woken::Up }, WAKING_NOTICE_AFTER, async {
        told = true;
        Ok::<(), Infallible>(())
    })
    .await;

    assert_eq!(woken, Woken::Up);
    assert!(notice.is_ok());
    assert!(!told, "an awake computer answers before the notice is due");
}

#[tokio::test(start_paused = true)]
async fn a_hibernated_computer_is_announced_once_and_then_awaited() {
    let mut told = 0;
    let (woken, notice) = noticed_after(
        async {
            // A restore and the runtime's dial.
            tokio::time::sleep(Duration::from_secs(4)).await;
            Woken::StillWaking
        },
        WAKING_NOTICE_AFTER,
        async {
            told += 1;
            Ok::<(), Infallible>(())
        },
    )
    .await;

    assert_eq!(woken, Woken::StillWaking);
    assert!(notice.is_ok());
    assert_eq!(told, 1);
}

#[test]
fn the_state_says_whether_the_computer_is_waking() {
    let state = ServerMessage::State {
        driver: None,
        driving_here: false,
        agent_held: false,
        surface: Surface::Desktop,
        transport: Transport::Vnc,
        viewers: 1,
        waking: true,
    };

    assert_eq!(
        serde_json::to_value(&state).unwrap(),
        serde_json::json!({
            "type": "state",
            "driver": null,
            "drivingHere": false,
            "agentHeld": false,
            "surface": "desktop",
            "transport": "vnc",
            "viewers": 1,
            "waking": true,
        })
    );
}

#[test]
fn a_viewer_leaving_or_the_fleet_saying_gone_needs_no_question() {
    assert_eq!(
        media_ending(Ok(MediaEnd::ViewerClosed)).unwrap().reason,
        EndReason::Stopped
    );
    assert_eq!(
        media_ending(Err(MediaError::Tunnel(TunnelError::ComputerOff)))
            .unwrap()
            .reason,
        EndReason::ComputerOff
    );
}

#[test]
fn a_stopped_computer_is_off_whatever_broke() {
    for stopped in [StoppedShort::GuestClosed, StoppedShort::TunnelFailed] {
        let ending = stopped_short_ending(stopped, Ok(ComputerPower::NotRunning));
        assert_eq!(ending.reason, EndReason::ComputerOff);
        assert_eq!(ending.error, None);
    }
}

#[test]
fn a_running_computer_whose_tunnel_failed_says_so() {
    for failure in [
        MediaError::Tunnel(TunnelError::Failed("OCI runtime exec failed".to_owned())),
        MediaError::Tunnel(TunnelError::Unreachable("host agent down".to_owned())),
        MediaError::Io(std::io::Error::other(TunnelExited::Code(1))),
    ] {
        let stopped = media_ending(Err(failure)).unwrap_err();
        assert_eq!(stopped, StoppedShort::TunnelFailed);
        let ending = stopped_short_ending(stopped, Ok(ComputerPower::Running));
        assert_eq!(ending.reason, EndReason::Error);
        // The fleet's own words stay in the log.
        assert_eq!(
            ending.error,
            Some((
                ErrorCode::TunnelFailed,
                "could not reach the computer's screen".to_owned()
            ))
        );
    }
}

#[test]
fn a_running_computer_whose_screen_closed_says_so() {
    let stopped = media_ending(Ok(MediaEnd::GuestClosed)).unwrap_err();
    let ending = stopped_short_ending(stopped, Ok(ComputerPower::Running));

    assert_eq!(ending.reason, EndReason::Error);
    assert_eq!(
        ending.error,
        Some((
            ErrorCode::SourceUnavailable,
            "the computer's screen closed".to_owned()
        ))
    );
}

#[test]
fn an_unknown_power_names_the_failure_rather_than_guess_off() {
    let ending = stopped_short_ending(
        StoppedShort::TunnelFailed,
        Err(TunnelError::Unreachable("database down".to_owned())),
    );

    assert_eq!(ending.reason, EndReason::Error);
}

fn lease_of(user: &str, session: SessionId) -> Lease {
    Lease {
        computer_id: ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0)),
        session_id: session,
        driver: Driver {
            user_id: MacroUserIdStr::try_from(format!("macro|{user}@example.com")).unwrap(),
            name: Some("Alice".to_owned()),
        },
        agent_user_id: None,
        started_at: chrono::Utc::now(),
        expires_at: chrono::Utc::now(),
    }
}

#[test]
fn a_tab_whose_lease_moved_to_another_tab_is_told_it_does_not_drive_here() {
    let first_tab = SessionId::new();
    let second_tab = SessionId::new();
    let moved = lease_of("alice", second_tab);

    assert!(!drives_here(Some(&moved), first_tab));
    assert!(drives_here(Some(&moved), second_tab));
    assert!(!drives_here(None, second_tab));
}

#[test]
fn any_tab_of_the_driver_may_hand_back_and_nobody_else() {
    let moved = lease_of("alice", SessionId::new());
    let alice = MacroUserIdStr::try_from("macro|alice@example.com".to_owned()).unwrap();
    let bob = MacroUserIdStr::try_from("macro|bob@example.com".to_owned()).unwrap();

    assert!(may_hand_back(Some(&moved), &alice));
    assert!(!may_hand_back(Some(&moved), &bob));
    assert!(!may_hand_back(None, &alice));
}

mod over_the_wire {
    //! The socket's loop against a real WebSocket client, a fake Xvnc and
    //! the real lease in Postgres.

    use std::sync::atomic::{AtomicBool, Ordering};

    use axum::extract::WebSocketUpgrade;
    use computer_screen::outbound::lease_changes::PgLeaseChanges;
    use computer_screen::outbound::pg::PgScreenRepo;
    use futures::{SinkExt as _, StreamExt as _};
    use harness_id::HarnessId;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::sync::Notify;
    use tokio_tungstenite::tungstenite::Message as ClientFrame;
    use tokio_util::task::TaskTracker;

    use super::*;
    use crate::computers::screen::access::{HarnessScreenAccess, MacroPeople};
    use crate::computers::screen::guest_files::GuestFiles;
    use crate::computers::screen::media::VncMedia;
    use crate::computers::screen::tunnel::GuestStream;

    const COMPUTER: ComputerId = ComputerId::new_from_uuid(uuid::Uuid::from_u128(0xC0));

    /// An Xvnc that greets each connection and records what reaches it.
    #[derive(Default)]
    struct FakeXvnc {
        received: Mutex<Vec<u8>>,
        changed: Notify,
    }

    impl FakeXvnc {
        fn received(&self) -> Vec<u8> {
            self.received.lock().unwrap().clone()
        }

        /// Wait until `marker` has reached the guest.
        async fn wait_for(&self, marker: &[u8]) {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self
                    .received()
                    .windows(marker.len())
                    .any(|window| window == marker)
                {
                    return;
                }
                changed.await;
            }
        }
    }

    struct FakeTunnel(Arc<FakeXvnc>);

    impl GuestTunnel for FakeTunnel {
        fn open(
            &self,
            _computer: ComputerId,
            _port: GuestPort,
        ) -> Pin<Box<dyn Future<Output = Result<GuestStream, TunnelError>> + Send + '_>> {
            let xvnc = Arc::clone(&self.0);
            Box::pin(async move {
                let (harness_end, mut guest_end) = tokio::io::duplex(1 << 20);
                tokio::spawn(async move {
                    guest_end.write_all(b"RFB 003.008\n").await.unwrap();
                    let mut buffer = [0u8; 4096];
                    loop {
                        match guest_end.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => {
                                xvnc.received
                                    .lock()
                                    .unwrap()
                                    .extend_from_slice(&buffer[..read]);
                                xvnc.changed.notify_waiters();
                            }
                        }
                    }
                });
                let (reader, writer) = tokio::io::split(harness_end);
                let reader: Pin<Box<dyn tokio::io::AsyncRead + Send>> = Box::pin(reader);
                let writer: Pin<Box<dyn tokio::io::AsyncWrite + Send>> = Box::pin(writer);
                Ok(tokio::io::join(reader, writer))
            })
        }
    }

    struct AwakeComputer;

    impl ScreenWaker for AwakeComputer {
        fn wake(
            &self,
            _harness: HarnessId,
        ) -> Pin<Box<dyn Future<Output = Result<Woken, TunnelError>> + Send + '_>> {
            Box::pin(async { Ok(Woken::Up) })
        }

        fn power(
            &self,
            _computer: ComputerId,
        ) -> Pin<Box<dyn Future<Output = Result<ComputerPower, TunnelError>> + Send + '_>> {
            Box::pin(async { Ok(ComputerPower::Running) })
        }
    }

    struct Rig {
        screens: Arc<Screens>,
        xvnc: Arc<FakeXvnc>,
        allowed: Arc<AtomicBool>,
        address: std::net::SocketAddr,
    }

    fn grant(user: &str, mode: Mode) -> ScreenGrant {
        ScreenGrant {
            harness_id: HarnessId::TEST_A,
            computer_id: COMPUTER,
            agent_user_id: Some(
                MacroUserIdStr::try_from("macro|scout@example.com".to_owned()).unwrap(),
            ),
            user_id: MacroUserIdStr::try_from(format!("macro|{user}@example.com")).unwrap(),
            transport: Transport::Vnc,
            surface: Surface::Desktop,
            mode,
        }
    }

    /// A socket route serving `grant`, as a redeemed ticket would.
    async fn rig(pool: PgPool, grant: ScreenGrant) -> Rig {
        let tasks = TaskTracker::new();
        let shutdown = CancellationToken::new();
        let screens = Arc::new(computer_screen::domain::service::ScreenService::new(
            PgScreenRepo::new(pool.clone()),
            GuestFiles::new(None, &tasks, shutdown.clone()),
            PgLeaseChanges::listen(pool.clone(), &tasks, shutdown.clone()).await,
            HarnessScreenAccess::new(
                Arc::new(harnesses::domain::service::HarnessServiceImpl::new(
                    harnesses::outbound::pg_harness_repo::PgHarnessRepo::new(pool.clone()),
                    hosted_runtimes::outbound::pg::PgComputerAgents::new(pool.clone()),
                )),
                hosted_runtimes::domain::rollout::ComputerRollout::default(),
                hosted_runtimes::outbound::pg::PgComputerAgents::new(pool.clone()),
            ),
            MacroPeople::new(pool),
        ));
        let xvnc = Arc::new(FakeXvnc::default());
        let allowed = Arc::new(AtomicBool::new(true));
        let viewers = Arc::new(Viewers::default());
        let route = {
            let screens = Arc::clone(&screens);
            let xvnc = Arc::clone(&xvnc);
            let allowed = Arc::clone(&allowed);
            move |upgrade: WebSocketUpgrade| {
                let allowed = Arc::clone(&allowed);
                let deps = SocketDeps {
                    screens: Arc::clone(&screens),
                    tunnel: Arc::new(FakeTunnel(Arc::clone(&xvnc))),
                    waker: Arc::new(AwakeComputer),
                    media: Arc::new(VncMedia),
                    viewers: Arc::clone(&viewers),
                    reauthorize: Arc::new(move || {
                        let allowed = allowed.load(Ordering::SeqCst);
                        Box::pin(async move { allowed })
                    }),
                    reauthorize_every: Duration::from_millis(100),
                    shutdown: CancellationToken::new(),
                };
                let grant = grant.clone();
                async move { upgrade.on_upgrade(move |socket| serve(socket, grant, deps, None)) }
            }
        };
        let app = axum::Router::new().route("/ws", axum::routing::get(route));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Rig {
            screens,
            xvnc,
            allowed,
            address,
        }
    }

    type Client = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    async fn connect(rig: &Rig) -> Client {
        let (client, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", rig.address))
            .await
            .unwrap();
        client
    }

    async fn send(client: &mut Client, message: serde_json::Value) {
        client
            .send(ClientFrame::text(message.to_string()))
            .await
            .unwrap();
    }

    /// The next control message, skipping media.
    async fn control(client: &mut Client) -> serde_json::Value {
        loop {
            match client.next().await.unwrap().unwrap() {
                ClientFrame::Text(text) => return serde_json::from_str(&text).unwrap(),
                ClientFrame::Binary(_) => {}
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    async fn control_of(client: &mut Client, kind: &str) -> serde_json::Value {
        loop {
            let message = control(client).await;
            if message["type"] == kind {
                return message;
            }
        }
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_driver_takes_over_and_hands_back_with_a_note(pool: PgPool) {
        let rig = rig(pool.clone(), grant("alice", Mode::Drive)).await;
        let mut client = connect(&rig).await;
        let first = control_of(&mut client, "state").await;
        assert_eq!(first["driver"], serde_json::Value::Null);

        send(&mut client, serde_json::json!({ "type": "takeOver" })).await;
        let driving = control_of(&mut client, "state").await;
        assert_eq!(driving["drivingHere"], true);
        assert_eq!(driving["agentHeld"], true);

        send(
            &mut client,
            serde_json::json!({ "type": "handBack", "note": "signed you in" }),
        )
        .await;
        // The take-over's own lease notification may come first.
        loop {
            let state = control_of(&mut client, "state").await;
            if state["driver"].is_null() {
                break;
            }
        }

        let drive = sqlx::query!("SELECT end_reason FROM computer_screen_drives")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(drive.end_reason.as_deref(), Some("handBack"));
        let notices = rig
            .screens
            .pending_notices(
                &MacroUserIdStr::try_from("macro|scout@example.com".to_owned()).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[1].notice.note.as_deref(), Some("signed you in"));
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_viewer_cannot_take_over_or_type(pool: PgPool) {
        let rig = rig(pool, grant("alice", Mode::View)).await;
        let mut client = connect(&rig).await;
        control_of(&mut client, "state").await;

        send(&mut client, serde_json::json!({ "type": "takeOver" })).await;
        assert_eq!(
            control_of(&mut client, "error").await["code"],
            "driveNotAllowed"
        );

        send(
            &mut client,
            serde_json::json!({ "type": "input", "event": { "kind": "text", "text": "rm -rf" } }),
        )
        .await;
        assert_eq!(control_of(&mut client, "error").await["code"], "notDriver");
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn raw_input_from_a_socket_that_does_not_drive_never_reaches_the_guest(pool: PgPool) {
        let rig = rig(pool, grant("alice", Mode::Drive)).await;
        let mut client = connect(&rig).await;
        control_of(&mut client, "state").await;

        // noVNC's handshake, a key press, then a frame request as a marker.
        let key_a = [4u8, 1, 0, 0, 0, 0, 0, 0x61];
        let marker = [3u8, 1, 0, 0, 0, 0, 0, 10, 0, 10];
        let mut frames: Vec<u8> = b"RFB 003.008\n".to_vec();
        frames.push(1); // security None
        frames.push(1); // ClientInit
        frames.extend_from_slice(&key_a);
        frames.extend_from_slice(&marker);
        client.send(ClientFrame::binary(frames)).await.unwrap();

        rig.xvnc.wait_for(&marker).await;
        assert!(
            !rig.xvnc
                .received()
                .windows(key_a.len())
                .any(|window| window == key_a),
            "a key reached the guest without the lease"
        );
    }

    #[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
    async fn a_driver_who_loses_access_is_ended_and_frees_the_agent(pool: PgPool) {
        let rig = rig(pool, grant("alice", Mode::Drive)).await;
        let mut client = connect(&rig).await;
        control_of(&mut client, "state").await;
        send(&mut client, serde_json::json!({ "type": "takeOver" })).await;
        assert_eq!(control_of(&mut client, "state").await["drivingHere"], true);

        rig.allowed.store(false, Ordering::SeqCst);

        assert_eq!(
            control_of(&mut client, "ended").await["reason"],
            "accessRevoked"
        );
        assert_eq!(rig.screens.lease(COMPUTER).await.unwrap(), None);
    }
}
