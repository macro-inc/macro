use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{TimeZone, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use team_agents::domain::{
    gateway::{
        BrainComputerPhase, BrainGatewayAccount, BrainGatewayAuthorizer, BrainGatewayComputer,
        BrainGatewayComputers, BrainGatewayDirectory, BrainGatewayError,
    },
    models::{Credential, TeamAgent, TeamAgentStatus},
};
use uuid::Uuid;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_0000000000aa);
const COMPUTER: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_0000000000bb);

fn agent_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|brain@example.com")
        .unwrap()
        .into_owned()
}

struct Directory;

impl BrainGatewayDirectory for Directory {
    async fn lookup(
        &self,
        key: &Credential,
    ) -> Result<Option<BrainGatewayAccount>, BrainGatewayError> {
        if !matches!(
            key.expose(),
            "brain-key" | "ordinary-key" | "wrong-membership-key" | "wrong-computer-team-key"
        ) {
            return Ok(None);
        }
        let agent_team = if key.expose() == "wrong-computer-team-key" {
            Uuid::nil()
        } else {
            TEAM
        };
        let agent = (key.expose() != "ordinary-key").then(|| TeamAgent {
            user_id: agent_user(),
            team_id: agent_team,
            name: "Brain".to_string(),
            email: "brain@example.com".to_string(),
            created_by: None,
            computer_id: Some(COMPUTER),
            status: TeamAgentStatus::Running,
            status_reason: None,
            setup: None,
            last_turn_at: None,
            created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        });
        Ok(Some(BrainGatewayAccount {
            user_id: agent_user(),
            agent,
            teams: if key.expose() == "wrong-membership-key" {
                vec![]
            } else {
                vec![agent_team]
            },
        }))
    }
}

struct Computers {
    phase: Mutex<BrainComputerPhase>,
    wakes: Arc<AtomicUsize>,
}

impl BrainGatewayComputers for Computers {
    async fn get(&self, id: Uuid) -> Result<Option<BrainGatewayComputer>, BrainGatewayError> {
        assert_eq!(id, COMPUTER);
        Ok(Some(BrainGatewayComputer {
            team_id: TEAM,
            phase: *self.phase.lock().unwrap(),
        }))
    }

    async fn wake(&self, id: Uuid) -> Result<Option<BrainGatewayComputer>, BrainGatewayError> {
        assert_eq!(*self.phase.lock().unwrap(), BrainComputerPhase::Frozen);
        self.wakes.fetch_add(1, Ordering::SeqCst);
        *self.phase.lock().unwrap() = BrainComputerPhase::Running;
        self.get(id).await
    }
}

#[derive(Default)]
struct Admission {
    users: Mutex<Vec<MacroUserIdStr<'static>>>,
    deny: bool,
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> ai_billing::domain::admission::AdmissionFuture<'a> {
        assert_eq!(feature, AiFeature::AgentSession);
        self.users.lock().unwrap().push(user.clone().into_owned());
        Box::pin(async move {
            if self.deny {
                Err(AiAdmissionError::Unavailable)
            } else {
                Ok(())
            }
        })
    }
}

fn brain_gateway(
    upstream: &str,
    phase: BrainComputerPhase,
    admission: Arc<Admission>,
) -> (Router, Arc<RecordingUsage>, Arc<AtomicUsize>) {
    let wakes = Arc::new(AtomicUsize::new(0));
    let access = BrainGatewayAuthorizer::new(
        Directory,
        Computers {
            phase: Mutex::new(phase),
            wakes: wakes.clone(),
        },
    );
    let usage = Arc::new(RecordingUsage::default());
    let state = GatewayState::new(
        Arc::new(InMemoryAgentSessionRepo::new()),
        admission,
        usage.clone(),
        upstream,
        "upstream-key",
    )
    .unwrap()
    .with_brains(Arc::new(access));
    (router(state), usage, wakes)
}

fn request(key: &str, model: &str) -> HttpRequest<Body> {
    HttpRequest::post("/brain/anthropic/v1/messages")
        .header("authorization", format!("Bearer {key}"))
        .body(Body::from(
            serde_json::json!({"model": model, "max_tokens": 16, "messages": []}).to_string(),
        ))
        .unwrap()
}

#[tokio::test]
async fn ordinary_user_api_keys_are_rejected_before_forwarding() {
    let (upstream, seen) = fake_anthropic().await;
    let (app, usage, wakes) = brain_gateway(
        &upstream,
        BrainComputerPhase::Running,
        Arc::new(Admission::default()),
    );
    let response = app
        .oneshot(request("ordinary-key", "claude-sonnet-5"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(seen.lock().unwrap().is_empty());
    assert!(usage.0.lock().unwrap().is_empty());
    assert_eq!(wakes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stopped_and_released_agent_computers_are_rejected() {
    let (upstream, seen) = fake_anthropic().await;
    for phase in [BrainComputerPhase::Stopped, BrainComputerPhase::Released] {
        let (app, usage, wakes) = brain_gateway(&upstream, phase, Arc::new(Admission::default()));
        assert_eq!(
            app.oneshot(request("brain-key", "claude-sonnet-5"))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(usage.0.lock().unwrap().is_empty());
        assert_eq!(wakes.load(Ordering::SeqCst), 0);
    }
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn brain_models_use_the_same_allowlist_before_admission_or_forwarding() {
    let (upstream, seen) = fake_anthropic().await;
    let admission = Arc::new(Admission::default());
    let (app, usage, _) = brain_gateway(&upstream, BrainComputerPhase::Running, admission.clone());
    assert_eq!(
        app.oneshot(request("brain-key", "unknown-model"))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert!(seen.lock().unwrap().is_empty());
    assert!(usage.0.lock().unwrap().is_empty());
    assert!(admission.users.lock().unwrap().is_empty());
}

#[tokio::test]
async fn running_brain_calls_shared_admission_and_records_agent_and_team_usage() {
    let (upstream, seen) = fake_anthropic().await;
    let admission = Arc::new(Admission::default());
    let (app, usage, wakes) =
        brain_gateway(&upstream, BrainComputerPhase::Running, admission.clone());
    let response = app
        .oneshot(request("brain-key", "claude-sonnet-5"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(*admission.users.lock().unwrap(), vec![agent_user()]);
    let events = usage.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user, agent_user());
    assert_eq!(events[0].entity, Some(TEAM));
    assert_eq!(events[0].feature, AiFeature::AgentSession);
    assert_eq!(events[0].agent_api_key_id, None);
    assert_eq!(wakes.load(Ordering::SeqCst), 0);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].headers["x-api-key"], "upstream-key");
    assert!(!seen[0].headers.contains_key("authorization"));
}

#[tokio::test]
async fn frozen_computers_are_woken_before_serving_a_brain_request() {
    let (upstream, seen) = fake_anthropic().await;
    let (app, usage, wakes) = brain_gateway(
        &upstream,
        BrainComputerPhase::Frozen,
        Arc::new(Admission::default()),
    );
    let response = app
        .oneshot(request("brain-key", "claude-sonnet-5"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(wakes.load(Ordering::SeqCst), 1);
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(usage.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn brain_admission_failure_never_calls_anthropic_or_records_usage() {
    let (upstream, seen) = fake_anthropic().await;
    let (app, usage, _) = brain_gateway(
        &upstream,
        BrainComputerPhase::Running,
        Arc::new(Admission {
            deny: true,
            ..Default::default()
        }),
    );
    assert_eq!(
        app.oneshot(request("brain-key", "claude-sonnet-5"))
            .await
            .unwrap()
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(seen.lock().unwrap().is_empty());
    assert!(usage.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_keys_are_rejected_and_brain_keys_cannot_use_the_session_route() {
    let (upstream, seen) = fake_anthropic().await;
    for (key, session_route) in [("revoked-key", false), ("brain-key", true)] {
        let (app, usage, _) = brain_gateway(
            &upstream,
            BrainComputerPhase::Running,
            Arc::new(Admission::default()),
        );
        let mut call = request(key, "claude-sonnet-5");
        if session_route {
            *call.uri_mut() = axum::http::Uri::from_static("/anthropic/v1/messages");
        }
        assert_eq!(
            app.oneshot(call).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert!(usage.0.lock().unwrap().is_empty());
    }
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn agent_membership_and_computer_team_must_match_before_spending() {
    let (upstream, seen) = fake_anthropic().await;
    for key in ["wrong-membership-key", "wrong-computer-team-key"] {
        let admission = Arc::new(Admission::default());
        let (app, usage, wakes) =
            brain_gateway(&upstream, BrainComputerPhase::Running, admission.clone());
        assert_eq!(
            app.oneshot(request(key, "claude-sonnet-5"))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(admission.users.lock().unwrap().is_empty());
        assert!(usage.0.lock().unwrap().is_empty());
        assert_eq!(wakes.load(Ordering::SeqCst), 0);
    }
    assert!(seen.lock().unwrap().is_empty());
}
