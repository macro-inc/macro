use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{TimeZone, Utc};
use firecracker_host_api::client::HostClient;
use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, MoveHolding, MoveTicket, Replicate, Replication, ReplicationState,
};
use firecracker_host_api::{
    Computer, ComputerId, ComputerResources, ComputerRole, ControlPlaneId, EnrollmentGeneration,
    GuestImage, PairingId, PowerState,
};
use tokio::io::{AsyncRead, AsyncWrite};
use tower::ServiceExt;
use uuid::Uuid;

use super::router;
use crate::domain::moves::MoveOperations;
use crate::domain::service::HostError;

const TICKET: &str = "0123456789abcdef0123456789abcdef";

fn computer_id() -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(7))
}

fn holding(live: bool, staged: bool) -> MoveHolding {
    MoveHolding {
        computer_id: computer_id(),
        live,
        staged,
        snapshots: vec!["move-1".to_owned()],
    }
}

fn round(state: ReplicationState, released: bool) -> Replication {
    Replication {
        state,
        released,
        snapshot: Some("move-1".to_owned()),
        incremental_from: None,
        bytes: 1024,
        started_at: Some(Utc.timestamp_opt(1_800_000_000, 0).unwrap()),
        finished_at: None,
    }
}

/// Answers every operation; `busy` refuses a release, `short` an expect;
/// `calls` records what the routes asked.
#[derive(Default)]
struct FakeOperations {
    busy: bool,
    calls: Mutex<Vec<String>>,
}

impl FakeOperations {
    fn log(&self, call: &str) {
        self.calls.lock().unwrap().push(call.to_owned());
    }
}

impl MoveOperations for FakeOperations {
    fn replication(&self, _computer_id: ComputerId) -> Replication {
        self.log("replication");
        round(ReplicationState::Done, false)
    }

    async fn replicate(
        self: Arc<Self>,
        _computer_id: ComputerId,
        request: Replicate,
    ) -> Result<Replication, HostError> {
        assert_eq!(request.ticket, MoveTicket::new(TICKET.to_owned()));
        self.log(&format!("replicate {}", request.target));
        Ok(round(ReplicationState::Running, false))
    }

    async fn release(&self, _computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        self.log("release");
        if self.busy {
            return Err(HostError::Busy("a replication round is running".to_owned()));
        }
        Ok(holding(false, true))
    }

    async fn move_holding(&self, _computer_id: ComputerId) -> Result<MoveHolding, HostError> {
        self.log("move_holding");
        Ok(holding(true, false))
    }

    async fn expect(
        &self,
        _computer_id: ComputerId,
        request: ExpectMove,
    ) -> Result<MoveHolding, HostError> {
        if request.ticket.expose().len() < 32 {
            return Err(HostError::MoveRefused("short ticket".to_owned()));
        }
        self.log("expect");
        Ok(holding(false, false))
    }

    async fn drop_staged(&self, _computer_id: ComputerId) -> Result<(), HostError> {
        self.log("drop_staged");
        Ok(())
    }

    async fn adopt(
        &self,
        computer_id: ComputerId,
        request: AdoptComputer,
    ) -> Result<Computer, HostError> {
        self.log("adopt");
        if request.control_plane_id.as_str() != "plane" {
            return Err(HostError::GenerationMismatch(computer_id));
        }
        Ok(Computer {
            computer_id,
            control_plane_id: request.control_plane_id,
            generation: request.generation,
            pairing_id: PairingId::new_from_uuid(Uuid::from_u128(9)),
            image: GuestImage::try_new("macro-box/1").unwrap(),
            role: ComputerRole::Person,
            resources: ComputerResources {
                vcpus: 2,
                memory_mib: 2048,
                root_disk_gib: 32,
                home_disk_gib: 20,
            },
            state: PowerState::Stopped,
            enrollment_present: false,
            created_at: Utc.timestamp_opt(1_800_000_000, 0).unwrap(),
            usage: None,
            restore_pending: false,
            last_launch: None,
        })
    }

    async fn serve_peer(&self, _connection: impl AsyncRead + AsyncWrite + Unpin + Send) {}
}

async fn call(
    operations: Arc<FakeOperations>,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .body(match body {
            Some(body) => Body::from(body.to_string()),
            None => Body::empty(),
        })
        .unwrap();
    let response = router(operations).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, body)
}

#[tokio::test]
async fn each_move_route_answers_its_status_and_body() {
    let operations = Arc::new(FakeOperations::default());
    let id = computer_id();

    let (status, body) = call(
        operations.clone(),
        "PUT",
        &format!("/v1/moves/{id}"),
        Some(serde_json::json!({ "ticket": TICKET, "expiresAt": "2027-01-01T00:00:00Z" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["live"], false);

    let (status, body) = call(
        operations.clone(),
        "POST",
        &format!("/v1/computers/{id}/replication"),
        Some(serde_json::json!({ "target": "10.88.0.2:8446", "ticket": TICKET })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["state"]["state"], "running");

    let (status, body) = call(
        operations.clone(),
        "GET",
        &format!("/v1/computers/{id}/replication"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["state"]["state"], "done");

    let (status, body) = call(
        operations.clone(),
        "POST",
        &format!("/v1/computers/{id}/release"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["staged"], true);

    let (status, body) = call(
        operations.clone(),
        "POST",
        &format!("/v1/moves/{id}/adopt"),
        Some(serde_json::json!({ "controlPlaneId": "plane", "generation": 3 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["state"], "stopped");

    let (status, body) = call(operations.clone(), "GET", &format!("/v1/moves/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["live"], true);

    let (status, _) = call(
        operations.clone(),
        "DELETE",
        &format!("/v1/moves/{id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        *operations.calls.lock().unwrap(),
        [
            "expect",
            "replicate 10.88.0.2:8446",
            "replication",
            "release",
            "adopt",
            "move_holding",
            "drop_staged"
        ]
    );
}

#[tokio::test]
async fn refusals_answer_their_codes() {
    let id = computer_id();
    let busy = Arc::new(FakeOperations {
        busy: true,
        ..FakeOperations::default()
    });
    let (status, body) = call(busy, "POST", &format!("/v1/computers/{id}/release"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "invalidState");

    let operations = Arc::new(FakeOperations::default());
    let (status, body) = call(
        operations.clone(),
        "PUT",
        &format!("/v1/moves/{id}"),
        Some(serde_json::json!({ "ticket": "short", "expiresAt": "2027-01-01T00:00:00Z" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["code"], "invalidRequest");
    // The refusal names no ticket.
    assert!(!body.to_string().contains("short\""));

    let (status, body) = call(
        operations,
        "POST",
        &format!("/v1/moves/{id}/adopt"),
        Some(serde_json::json!({ "controlPlaneId": "other", "generation": 3 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "generationMismatch");
}

/// The one client against the move routes: a path, method or body that
/// drifts between them fails here.
#[tokio::test]
async fn the_client_and_the_move_routes_agree_on_every_route() {
    let operations = Arc::new(FakeOperations::default());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = router(operations.clone());
    tokio::spawn(async move { axum::serve(listener, app).await });
    let client = HostClient::over_plain_http(&format!("http://{address}")).unwrap();
    let id = computer_id();
    let ticket = MoveTicket::new(TICKET.to_owned());

    client
        .expect_move(
            id,
            &ExpectMove {
                ticket: ticket.clone(),
                expires_at: Utc.timestamp_opt(1_900_000_000, 0).unwrap(),
            },
        )
        .await
        .unwrap();
    let running = client
        .replicate(
            id,
            &Replicate {
                target: "10.88.0.2:8446".to_owned(),
                ticket,
            },
        )
        .await
        .unwrap();
    assert_eq!(running.state, ReplicationState::Running);
    assert_eq!(
        client.replication(id).await.unwrap().state,
        ReplicationState::Done
    );
    assert!(client.release(id).await.unwrap().staged);
    let adopted = client
        .adopt(
            id,
            &AdoptComputer {
                control_plane_id: ControlPlaneId::try_new("plane").unwrap(),
                generation: EnrollmentGeneration::new(3),
            },
        )
        .await
        .unwrap();
    assert_eq!(adopted.computer_id, id);
    assert!(client.move_holding(id).await.unwrap().live);
    client.drop_staged(id).await.unwrap();
    assert_eq!(operations.calls.lock().unwrap().len(), 7);
}
