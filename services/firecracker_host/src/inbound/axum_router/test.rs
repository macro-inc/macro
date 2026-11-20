use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{TimeZone, Utc};
use firecracker_host_api::client::HostClient;
use firecracker_host_api::exec::{ExecRequest, Frame, MAX_FRAME_BYTES, read_frame, write_frame};
use firecracker_host_api::{
    Action, Computer, ComputerId, ComputerResources, ComputerRole, ControlPlaneId, CreateComputer,
    EnrollmentDocument, EnrollmentGeneration, ErrorCode, GoldenImage, GoldenKey, GoldenState,
    GuestImage, HostInfo, HostLimits, NetworkSlots, PairingId, PowerState, SetEnrollment,
};
use tower::ServiceExt;
use uuid::Uuid;

use super::{HostRouterState, host_router, stamp_trace_id};
use crate::domain::ports::HostOperations;
use crate::domain::power::NotApplicable;
use crate::domain::service::HostError;

/// Computers in a map; a golden is ready unless its image is `building`;
/// the guest agent answers every exec with `hello` and exit 0.
#[derive(Default)]
struct FakeOperations {
    computers: Mutex<HashMap<ComputerId, Computer>>,
    limits: Mutex<Option<HostLimits>>,
}

fn computer(computer_id: ComputerId, request: &CreateComputer) -> Computer {
    Computer {
        computer_id,
        control_plane_id: request.control_plane_id.clone(),
        generation: request.generation,
        pairing_id: request.pairing_id,
        image: request.image.clone(),
        role: request.role,
        resources: request.resources,
        state: PowerState::Running,
        enrollment_present: true,
        created_at: Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
        usage: None,
        restore_pending: false,
        last_launch: None,
    }
}

impl HostOperations for FakeOperations {
    type GuestStream = tokio::io::DuplexStream;

    fn host(&self) -> HostInfo {
        HostInfo {
            name: "test-host".to_owned(),
            firecracker_version: "v1.18.0".to_owned(),
            agent_version: None,
            limits: self.limits.lock().unwrap().clone(),
            cpus: 32,
            memory_total_bytes: 1,
            memory_available_bytes: 1,
            guest_resident_memory_bytes: 0,
            ksm_shared_bytes: 0,
            network_slots: NetworkSlots { total: 4, free: 4 },
            images: vec![GuestImage::try_new("macro-box/1").unwrap()],
            goldens: Vec::new(),
            move_address: None,
        }
    }

    fn goldens(&self) -> Vec<GoldenImage> {
        Vec::new()
    }

    async fn set_host_limits(&self, limits: HostLimits) -> Result<(), HostError> {
        *self.limits.lock().unwrap() = Some(limits);
        Ok(())
    }

    fn build_golden(&self, key: GoldenKey) -> Result<GoldenImage, HostError> {
        let state = if key.image.as_str() == "building" {
            GoldenState::Building
        } else {
            GoldenState::Ready {
                created_at: Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
            }
        };
        Ok(GoldenImage { key, state })
    }

    async fn list(&self) -> Result<Vec<Computer>, HostError> {
        Ok(self.computers.lock().unwrap().values().cloned().collect())
    }

    async fn get(&self, computer_id: ComputerId) -> Result<Computer, HostError> {
        self.computers
            .lock()
            .unwrap()
            .get(&computer_id)
            .cloned()
            .ok_or(HostError::NotFound(computer_id))
    }

    async fn create(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: CreateComputer,
    ) -> Result<Computer, HostError> {
        if request.image.as_str() == "missing" {
            return Err(HostError::ImageMissing(request.image));
        }
        let created = computer(computer_id, &request);
        self.computers
            .lock()
            .unwrap()
            .insert(computer_id, created.clone());
        Ok(created)
    }

    async fn power(&self, computer_id: ComputerId, action: Action) -> Result<Computer, HostError> {
        let mut computers = self.computers.lock().unwrap();
        let computer = computers
            .get_mut(&computer_id)
            .ok_or(HostError::NotFound(computer_id))?;
        computer.state = match (action, computer.state) {
            (Action::Freeze, PowerState::Stopped) => {
                return Err(HostError::InvalidState(NotApplicable {
                    state: computer.state,
                    action,
                }));
            }
            (Action::Stop, _) => PowerState::Stopped,
            (Action::Freeze, _) => PowerState::Paused,
            (Action::Hibernate, _) => PowerState::Hibernated,
            (Action::Start | Action::Restart | Action::Unfreeze, _) => PowerState::Running,
        };
        Ok(computer.clone())
    }

    async fn set_enrollment(
        &self,
        computer_id: ComputerId,
        request: SetEnrollment,
    ) -> Result<Computer, HostError> {
        let mut computers = self.computers.lock().unwrap();
        let computer = computers
            .get_mut(&computer_id)
            .ok_or(HostError::NotFound(computer_id))?;
        computer.pairing_id = request.pairing_id;
        computer.enrollment_present = true;
        Ok(computer.clone())
    }

    async fn clear_enrollment(&self, computer_id: ComputerId) -> Result<(), HostError> {
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&computer_id) {
            computer.enrollment_present = false;
        }
        Ok(())
    }

    async fn destroy(&self, computer_id: ComputerId) -> Result<(), HostError> {
        self.computers.lock().unwrap().remove(&computer_id);
        Ok(())
    }

    async fn connect_guest(
        &self,
        computer_id: ComputerId,
    ) -> Result<tokio::io::DuplexStream, HostError> {
        self.get(computer_id).await?;
        let (host, mut guest) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            while let Ok(Some(frame)) = read_frame(&mut guest).await {
                if frame == Frame::CloseStdin {
                    let _ = write_frame(&mut guest, &Frame::Stdout(b"hello".to_vec())).await;
                    let _ = write_frame(&mut guest, &Frame::Exited(0)).await;
                }
            }
        });
        Ok(host)
    }
}

fn computer_id() -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(7))
}

fn create_request(image: &str) -> CreateComputer {
    CreateComputer {
        control_plane_id: ControlPlaneId::try_new("test").unwrap(),
        generation: EnrollmentGeneration::new(1),
        pairing_id: PairingId::new_from_uuid(Uuid::from_u128(9)),
        image: GuestImage::try_new(image).unwrap(),
        role: ComputerRole::Agent,
        resources: ComputerResources {
            vcpus: 2,
            memory_mib: 2048,
            root_disk_gib: 20,
            home_disk_gib: 10,
        },
        enrollment: EnrollmentDocument(serde_json::json!({})),
        start: true,
        return_when_resumed: false,
    }
}

async fn send(router: axum::Router, request: Request<Body>) -> (StatusCode, serde_json::Value) {
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, body)
}

#[tokio::test]
async fn errors_answer_their_status_and_wire_code() {
    let router = host_router(HostRouterState::new(Arc::new(FakeOperations::default())));

    let (status, body) = send(
        router.clone(),
        Request::get(format!("/v1/computers/{}", computer_id()))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "notFound");

    let (status, body) = send(
        router,
        Request::put(format!("/v1/computers/{}", computer_id()))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&create_request("missing")).unwrap(),
            ))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "imageMissing");
}

#[tokio::test]
async fn a_golden_still_building_answers_accepted() {
    let router = host_router(HostRouterState::new(Arc::new(FakeOperations::default())));
    let key = |image: &str| GoldenKey {
        image: GuestImage::try_new(image).unwrap(),
        vcpus: 2,
        memory_mib: 2048,
    };

    let (building, _) = send(
        router.clone(),
        Request::post("/v1/goldens")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&key("building")).unwrap()))
            .unwrap(),
    )
    .await;
    let (ready, _) = send(
        router,
        Request::post("/v1/goldens")
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&key("macro-box/1")).unwrap()))
            .unwrap(),
    )
    .await;

    assert_eq!(building, StatusCode::ACCEPTED);
    assert_eq!(ready, StatusCode::OK);
}

#[tokio::test]
async fn exec_of_a_missing_computer_is_a_json_error_not_an_upgrade() {
    let router = host_router(HostRouterState::new(Arc::new(FakeOperations::default())));

    let (status, body) = send(
        router,
        Request::get(format!("/v1/computers/{}/exec", computer_id()))
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-version", "13")
            .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
            .body(Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "notFound");
}

/// The one client against the real router: a path, method or body that
/// drifts between them fails here.
#[tokio::test]
async fn the_client_and_the_router_agree_on_every_route() {
    let router = host_router(HostRouterState::new(Arc::new(FakeOperations::default())));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await });
    let client = HostClient::over_plain_http(&format!("http://{address}")).unwrap();

    assert_eq!(client.host().await.unwrap().name, "test-host");
    let limits = HostLimits {
        guest_memory_max_bytes: 100 << 30,
        squeeze_above_bytes: Some(70 << 30),
        squeeze_below_bytes: Some(80 << 30),
        home_disk_gib: vec![20],
    };
    client.set_host_limits(&limits).await.unwrap();
    assert_eq!(client.host().await.unwrap().limits, Some(limits));
    assert_eq!(client.goldens().await.unwrap(), Vec::new());
    let golden = client
        .build_golden(&GoldenKey {
            image: GuestImage::try_new("macro-box/1").unwrap(),
            vcpus: 2,
            memory_mib: 2048,
        })
        .await
        .unwrap();
    assert!(matches!(golden.state, GoldenState::Ready { .. }));

    let created = client
        .create(computer_id(), &create_request("macro-box/1"))
        .await
        .unwrap();
    assert_eq!(created.role, ComputerRole::Agent);
    assert_eq!(client.computer(computer_id()).await.unwrap(), created);
    assert_eq!(client.computers().await.unwrap(), vec![created]);

    let stopped = client.power(computer_id(), Action::Stop).await.unwrap();
    assert_eq!(stopped.state, PowerState::Stopped);
    let refused = client
        .power(computer_id(), Action::Freeze)
        .await
        .unwrap_err();
    assert_eq!(refused.code(), Some(ErrorCode::InvalidState));
    client.power(computer_id(), Action::Start).await.unwrap();

    let pairing_id = PairingId::new_from_uuid(Uuid::from_u128(10));
    let enrolled = client
        .set_enrollment(
            computer_id(),
            &SetEnrollment {
                generation: EnrollmentGeneration::new(1),
                pairing_id,
                enrollment: EnrollmentDocument(serde_json::json!({})),
            },
        )
        .await
        .unwrap();
    assert_eq!(enrolled.pairing_id, pairing_id);
    client.clear_enrollment(computer_id()).await.unwrap();
    assert!(
        !client
            .computer(computer_id())
            .await
            .unwrap()
            .enrollment_present
    );

    let mut session = client
        .exec(
            computer_id(),
            ExecRequest {
                argv: vec!["echo".to_owned()],
                uid: 0,
                gid: 0,
                env: BTreeMap::new(),
                cwd: "/".to_owned(),
                trace_id: None,
            },
        )
        .await
        .unwrap();
    session.close_stdin().await.unwrap();
    assert_eq!(
        session.next().await.unwrap(),
        Some(Frame::Stdout(b"hello".to_vec()))
    );
    assert_eq!(session.next().await.unwrap(), Some(Frame::Exited(0)));

    client.destroy(computer_id()).await.unwrap();
    let refused = client
        .exec(
            computer_id(),
            ExecRequest {
                argv: vec!["echo".to_owned()],
                uid: 0,
                gid: 0,
                env: BTreeMap::new(),
                cwd: "/".to_owned(),
                trace_id: None,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code(), Some(ErrorCode::NotFound));
    assert_eq!(
        client.computer(computer_id()).await.unwrap_err().code(),
        Some(ErrorCode::NotFound)
    );
}

#[test]
fn a_start_frame_gets_the_trace_id_only_while_it_stays_within_the_frame_limit() {
    const TRACE_ID: &str = "11111111111111111111111111111111";
    let request = |padding: usize| ExecRequest {
        argv: vec!["a".repeat(padding)],
        uid: 0,
        gid: 0,
        env: BTreeMap::new(),
        cwd: "/".to_owned(),
        trace_id: None,
    };
    let encoded_length =
        |request: &ExecRequest| Frame::Start(request.clone()).encode().unwrap().len();

    let mut small = request(1);
    stamp_trace_id(&mut small, Some(TRACE_ID.to_owned()));
    assert_eq!(small.trace_id.as_deref(), Some(TRACE_ID));

    // A client's start frame exactly at the limit, which the WebSocket admits.
    let padding = MAX_FRAME_BYTES as usize - encoded_length(&request(0));
    let mut full = request(padding);
    assert_eq!(encoded_length(&full), MAX_FRAME_BYTES as usize);
    stamp_trace_id(&mut full, Some(TRACE_ID.to_owned()));
    assert_eq!(full.trace_id, None);
    assert_eq!(encoded_length(&full), MAX_FRAME_BYTES as usize);
}
