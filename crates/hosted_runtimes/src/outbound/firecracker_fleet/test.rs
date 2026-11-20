use std::str::FromStr;

use futures::{SinkExt, StreamExt};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::domain::ids::PairingId;

mod memory;
use tokio_tungstenite::tungstenite::Message;

const COMPUTER_ID: ComputerId =
    ComputerId::new_from_uuid(Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001));
const COMPUTER_PATH: &str = "/v1/computers/01900000-0000-7000-8000-000000000001";

fn config() -> FirecrackerFleetConfig {
    FirecrackerFleetConfig {
        control_plane_id: ControlPlaneId::try_new("test-a").unwrap(),
        images: GuestImages {
            regular: GuestImage::try_new("macro-box/2026-11-17").unwrap(),
            agent: GuestImage::try_new("macro-box-agent/2026-11-17").unwrap(),
        },
        host_name: crate::domain::models::HostName::try_new("microvm-1").unwrap(),
    }
}

fn fleet(server: &MockServer) -> FirecrackerFleet {
    FirecrackerFleet::over_plain_http(&server.uri(), config()).unwrap()
}

fn computer(phase: crate::domain::lifecycle::Phase) -> Computer {
    Computer {
        id: COMPUTER_ID,
        team_id: Uuid::nil(),
        name: crate::domain::models::ComputerName::try_new("Fixture computer").unwrap(),
        size: crate::domain::size::ComputerSize::Standard,
        resources: ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        },
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-10".to_owned())
            .unwrap(),
        funding: crate::domain::models::Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_saved").unwrap(),
        },
        host: crate::domain::ids::HostId::new(Uuid::nil()),
        state: crate::domain::fakes::state(phase),
        harness_id: None,
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        created_at: "2026-11-05T10:00:00Z".parse().unwrap(),
        enrolled_at: None,
        hibernated_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
        enrollment_generation: Default::default(),
    }
}

fn provisioning() -> Computer {
    computer(crate::domain::lifecycle::Phase::Provisioning { start: true })
}

/// The agent's answer for the fixture computer.
fn host_computer(control_plane_id: &str, generation: u32, state: &str) -> serde_json::Value {
    json!({
        "computerId": COMPUTER_ID.to_string(),
        "controlPlaneId": control_plane_id,
        "generation": generation,
        "pairingId": "00000000-0000-0000-0000-000000000001",
        "image": "macro-box/2026-11-17",
        "role": "person",
        "resources": {"vcpus": 4, "memoryMib": 8192, "rootDiskGib": 32, "homeDiskGib": 68},
        "state": state,
        "restorePending": false,
        "enrollmentPresent": true,
        "createdAt": "2026-11-17T12:00:00Z",
        "usage": null
    })
}

fn error(code: &str) -> serde_json::Value {
    json!({"code": code, "message": "fixture"})
}

/// Records what creation asked of the enrollment.
#[derive(Default)]
struct FixtureEnrollment {
    claimed: bool,
    /// Issue an agent teammate's enrollment.
    agent: bool,
    checked: std::sync::Mutex<Vec<PairingId>>,
    issued: std::sync::atomic::AtomicUsize,
}

impl FleetEnrollment for FixtureEnrollment {
    async fn claimed(&self, pairing: PairingId) -> Result<bool, EnrollmentIssueError> {
        self.checked.lock().unwrap().push(pairing);
        Ok(self.claimed)
    }

    async fn issue(&self) -> Result<crate::domain::enrollment::Enrollment, EnrollmentIssueError> {
        self.issued
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(crate::domain::fakes::enrollment(COMPUTER_ID, self.agent))
    }
}

async fn missing(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(COMPUTER_PATH))
        .respond_with(ResponseTemplate::new(404).set_body_json(error("notFound")))
        .mount(server)
        .await;
}

#[tokio::test]
async fn a_new_computer_is_restored_with_its_shape_and_enrollment() {
    let server = MockServer::start().await;
    missing(&server).await;
    Mock::given(method("PUT"))
        .and(path(COMPUTER_PATH))
        .and(body_partial_json(json!({
            "controlPlaneId": "test-a",
            "generation": 1,
            "pairingId": "00000000-0000-0000-0000-000000000001",
            "image": "macro-box/2026-11-17",
            "role": "person",
            "resources": {"vcpus": 4, "memoryMib": 8192, "rootDiskGib": 32, "homeDiskGib": 68},
            "start": true,
            "returnWhenResumed": false,
            "enrollment": {"computer_id": COMPUTER_ID.to_string(), "generation": 1},
        })))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(host_computer("test-a", 1, "running")),
        )
        .expect(1)
        .mount(&server)
        .await;
    let enrollment = FixtureEnrollment::default();

    let image = fleet(&server)
        .create(
            &provisioning(),
            EnrollmentGeneration::new(1),
            &enrollment,
            true,
        )
        .await
        .unwrap();

    assert_eq!(image, GuestImage::try_new("macro-box/2026-11-17").unwrap());
    assert_eq!(
        enrollment.issued.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
}

#[tokio::test]
async fn an_agent_teammates_computer_is_restored_as_an_agent_from_the_agent_image() {
    let server = MockServer::start().await;
    missing(&server).await;
    let mut answer = host_computer("test-a", 1, "running");
    answer["image"] = json!("macro-box-agent/2026-11-17");
    answer["role"] = json!("agent");
    Mock::given(method("PUT"))
        .and(path(COMPUTER_PATH))
        .and(body_partial_json(json!({
            "image": "macro-box-agent/2026-11-17",
            "role": "agent",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(answer))
        .expect(1)
        .mount(&server)
        .await;

    let image = fleet(&server)
        .create(
            &provisioning(),
            EnrollmentGeneration::new(1),
            &FixtureEnrollment {
                agent: true,
                ..Default::default()
            },
            true,
        )
        .await
        .unwrap();

    assert_eq!(
        image,
        GuestImage::try_new("macro-box-agent/2026-11-17").unwrap()
    );
}

#[tokio::test]
async fn a_claimed_guest_completes_creation_without_a_new_enrollment() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(COMPUTER_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(host_computer("test-a", 1, "running")),
        )
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let enrollment = FixtureEnrollment {
        claimed: true,
        ..Default::default()
    };

    let image = fleet(&server)
        .create(
            &provisioning(),
            EnrollmentGeneration::new(1),
            &enrollment,
            true,
        )
        .await
        .unwrap();

    assert_eq!(image, GuestImage::try_new("macro-box/2026-11-17").unwrap());
    assert_eq!(
        *enrollment.checked.lock().unwrap(),
        vec![PairingId::new_from_uuid(Uuid::from_u128(1))]
    );
    assert_eq!(
        enrollment.issued.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}

#[tokio::test]
async fn an_unclaimed_guest_gets_a_fresh_enrollment_and_is_started() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(COMPUTER_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(host_computer(
            "test-a",
            1,
            "hibernated",
        )))
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path(format!("{COMPUTER_PATH}/enrollment")))
        .and(body_partial_json(json!({
            "generation": 1,
            "pairingId": "00000000-0000-0000-0000-000000000001",
            "enrollment": {"computer_id": COMPUTER_ID.to_string()},
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(host_computer(
            "test-a",
            1,
            "hibernated",
        )))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("{COMPUTER_PATH}/start")))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(host_computer("test-a", 1, "running")),
        )
        .expect(1)
        .mount(&server)
        .await;

    fleet(&server)
        .create(
            &provisioning(),
            EnrollmentGeneration::new(1),
            &FixtureEnrollment::default(),
            true,
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn a_guest_of_another_generation_or_control_plane_is_never_reused() {
    for (control_plane_id, generation) in [("test-a", 2), ("test-b", 1)] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(COMPUTER_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(host_computer(
                control_plane_id,
                generation,
                "running",
            )))
            .mount(&server)
            .await;

        let error = fleet(&server)
            .create(
                &provisioning(),
                EnrollmentGeneration::new(1),
                &FixtureEnrollment::default(),
                true,
            )
            .await
            .unwrap_err();

        assert!(
            matches!(error, FirecrackerFleetError::EnrollmentMismatch { .. }),
            "{error:?}"
        );
    }
}

#[tokio::test]
async fn a_missing_guest_of_a_running_computer_is_lost_not_recreated() {
    let server = MockServer::start().await;
    missing(&server).await;

    let error = fleet(&server)
        .create(
            &computer(crate::domain::lifecycle::Phase::Running),
            EnrollmentGeneration::new(1),
            &FixtureEnrollment::default(),
            true,
        )
        .await
        .unwrap_err();

    assert!(error.is_missing());
}

#[tokio::test]
async fn stopping_destroying_and_clearing_a_missing_guest_succeed() {
    let server = MockServer::start().await;
    for (verb, route) in [
        ("POST", format!("{COMPUTER_PATH}/stop")),
        ("DELETE", COMPUTER_PATH.to_owned()),
        ("DELETE", format!("{COMPUTER_PATH}/enrollment")),
    ] {
        Mock::given(method(verb))
            .and(path(route))
            .respond_with(ResponseTemplate::new(404).set_body_json(error("notFound")))
            .expect(1)
            .mount(&server)
            .await;
    }
    let fleet = fleet(&server);

    fleet.stop(COMPUTER_ID).await.unwrap();
    fleet.destroy(COMPUTER_ID).await.unwrap();
    fleet.clear_enrollment(COMPUTER_ID).await.unwrap();
}

#[tokio::test]
async fn error_codes_decide_lost_permanent_and_retried() {
    for (status, code, missing, permanent) in [
        (404, "notFound", true, false),
        (409, "generationMismatch", false, true),
        (422, "imageMissing", false, true),
        (503, "goldenNotReady", false, false),
        (503, "noNetworkSlot", false, false),
        (504, "guestUnreachable", false, false),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(format!("{COMPUTER_PATH}/start")))
            .respond_with(ResponseTemplate::new(status).set_body_json(error(code)))
            .mount(&server)
            .await;

        let error = fleet(&server).start(COMPUTER_ID).await.unwrap_err();

        assert_eq!(
            (error.is_missing(), error.is_permanent()),
            (missing, permanent),
            "{code}"
        );
    }
}

#[tokio::test]
async fn listing_keeps_this_control_planes_guests_and_counts_sleeping_ones_as_on() {
    let server = MockServer::start().await;
    let mut foreign = host_computer("test-b", 1, "running");
    foreign["computerId"] = json!("01900000-0000-7000-8000-000000000002");
    Mock::given(method("GET"))
        .and(path("/v1/computers"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!([host_computer("test-a", 1, "paused"), foreign,])),
        )
        .mount(&server)
        .await;

    let instances = fleet(&server).instances().await.unwrap();

    assert_eq!(
        instances,
        vec![FleetInstance {
            computer_id: COMPUTER_ID,
            status: InstanceStatus::Running,
            control_plane_id: ControlPlaneId::try_new("test-a").unwrap(),
            created_at: Some("2026-11-17T12:00:00Z".parse().unwrap()),
        }]
    );
}

#[tokio::test]
async fn the_host_registers_under_its_row_name_with_the_rows_policy() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/host"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "microvm-profile-1",
            "firecrackerVersion": "v1.18.0",
            "cpus": 32,
            "memoryTotalBytes": 128u64 * 1024 * 1024 * 1024,
            "memoryAvailableBytes": 100u64 * 1024 * 1024 * 1024,
            "guestResidentMemoryBytes": 4u64 * 1024 * 1024 * 1024,
            "ksmSharedBytes": 0,
            "networkSlots": {"total": 128, "free": 120},
            "images": ["macro-box/2026-11-17"],
            "goldens": []
        })))
        .mount(&server)
        .await;

    assert_eq!(
        fleet(&server).host().await.unwrap(),
        HostRegistration {
            name: crate::domain::models::HostName::try_new("microvm-1").unwrap(),
            vcpus: 32,
            memory_gb: 128,
        }
    );
}

#[tokio::test]
async fn resources_match_compares_the_sold_shape() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(COMPUTER_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(host_computer("test-a", 1, "running")),
        )
        .mount(&server)
        .await;
    let fleet = fleet(&server);
    let mut bigger = provisioning();
    bigger.resources.memory_gib = crate::domain::size::MemoryGib::new(16);

    assert!(fleet.resources_match(&provisioning()).await.unwrap());
    assert!(!fleet.resources_match(&bigger).await.unwrap());
}

/// A one-connection exec endpoint: checks the start frame, echoes stdin
/// to stdout once stdin closes, writes `oops` to stderr and exits 3.
#[expect(
    clippy::result_large_err,
    reason = "tungstenite's handshake callback returns its own error response"
)]
async fn exec_server(expect_uid: u32) -> (String, tokio::task::JoinHandle<ExecRequest>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let served = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_hdr_async(
            stream,
            |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
                assert_eq!(request.uri().path(), format!("{COMPUTER_PATH}/exec"));
                Ok(response)
            },
        )
        .await
        .unwrap();
        let next = |message: Message| Frame::decode(&message.into_data()).unwrap();
        let Frame::Start(request) = next(socket.next().await.unwrap().unwrap()) else {
            panic!("the first frame starts the program");
        };
        assert_eq!(request.uid, expect_uid);
        let mut stdin = Vec::new();
        loop {
            match next(socket.next().await.unwrap().unwrap()) {
                Frame::Stdin(bytes) => stdin.extend(bytes),
                Frame::CloseStdin => break,
                other => panic!("unexpected {other:?}"),
            }
        }
        for frame in [
            Frame::Stdout(stdin),
            Frame::Stderr(b"oops".to_vec()),
            Frame::Exited(3),
        ] {
            socket
                .send(Message::binary(frame.encode().unwrap()))
                .await
                .unwrap();
        }
        request
    });
    (url, served)
}

#[tokio::test]
async fn exec_streams_stdin_to_stdout_as_the_macro_user_and_reports_the_exit_code() {
    let (url, served) = exec_server(GUEST_USER.uid).await;
    let fleet = FirecrackerFleet::over_plain_http(&url, config()).unwrap();

    let mut process = fleet.exec(COMPUTER_ID, &["cat"]).await.unwrap();
    process.stdin.write_all(b"hello").await.unwrap();
    drop(process.stdin);
    let mut stdout = String::new();
    let (read, exit) = tokio::join!(process.stdout.read_to_string(&mut stdout), process.exit);
    read.unwrap();

    assert_eq!(exit.unwrap(), 3);
    assert_eq!(stdout, "hello");
    let request = served.await.unwrap();
    assert_eq!(request.argv, vec!["cat"]);
    assert_eq!(request.cwd, GUEST_USER.home);
    assert_eq!(request.gid, GUEST_USER.gid);
}

#[tokio::test]
async fn exec_output_reaches_a_caller_that_reads_it_before_waiting_for_the_exit() {
    let (url, _served) = exec_server(GUEST_USER.uid).await;
    let fleet = FirecrackerFleet::over_plain_http(&url, config()).unwrap();

    let mut process = fleet.exec(COMPUTER_ID, &["cat"]).await.unwrap();
    process.stdin.write_all(b"hello\n").await.unwrap();
    drop(process.stdin);
    // harnessd's exchange reads its one answer line, then waits for the exit.
    let mut line = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::io::AsyncBufReadExt::read_line(
            &mut tokio::io::BufReader::new(process.stdout),
            &mut line,
        ),
    )
    .await
    .expect("stdout flows before the exit is awaited")
    .unwrap();

    assert_eq!(line, "hello\n");
    assert_eq!(process.exit.await.unwrap(), 3);
}

#[tokio::test]
async fn restarting_macrod_runs_systemctl_as_root_and_fails_on_a_nonzero_exit() {
    let (url, served) = exec_server(ROOT).await;
    let fleet = FirecrackerFleet::over_plain_http(&url, config()).unwrap();

    let error = fleet.restart_macrod(COMPUTER_ID).await.unwrap_err();

    assert!(
        matches!(
            error,
            FirecrackerFleetError::Exec(ExecFailure::ExitCode { code: 3 })
        ),
        "{error:?}"
    );
    assert_eq!(
        served.await.unwrap().argv,
        vec!["systemctl", "restart", "macrod"]
    );
}
