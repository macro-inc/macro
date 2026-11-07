use super::*;
use crate::domain::coding_agents::CodingAgentError;
use crate::domain::model::StoredAgentSessionLog;
use crate::domain::updates::{CodingAgentUpdatesRepo, UpdateCandidate, UpdateTurnState};

/// One stalled session belonging to `OWNER`; nobody else has any.
#[derive(Default)]
struct OwnerSessions {
    asked_for: Mutex<Vec<String>>,
}

impl CodingAgentUpdatesRepo for OwnerSessions {
    async fn candidates(
        &self,
        owner: MacroUserIdStr<'static>,
    ) -> Result<Vec<UpdateCandidate>, CodingAgentError> {
        self.asked_for
            .lock()
            .unwrap()
            .push(owner.as_ref().to_owned());
        if owner.as_ref() != OWNER {
            return Ok(Vec::new());
        }
        Ok(vec![UpdateCandidate {
            id: AgentSessionId::new_from_uuid(
                Uuid::parse_str("0197d5c4-0000-7000-8000-000000000001").unwrap(),
            ),
            name: "Fix login".into(),
            harness: "cursor".into(),
            pull_request_url: None,
            turn_state: UpdateTurnState::Running,
            archived: false,
            last_activity: "2026-11-01T10:00:00Z".parse().unwrap(),
        }])
    }

    async fn log(&self, _: AgentSessionId) -> Result<Vec<StoredAgentSessionLog>, CodingAgentError> {
        Ok(Vec::new())
    }
}

async fn updates(router: Router, caller: &str) -> serde_json::Value {
    let response = router
        .oneshot(
            Request::get("/updates")
                .header(header::AUTHORIZATION, format!("Bearer {caller}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 8192)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn updates_list_only_the_callers_stalled_sessions() {
    let sessions = OwnerSessions::default();
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let state = AgentSessionRouterState::new(
        sessions,
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(auth)),
    );
    let router: Router =
        crate::inbound::axum_router::updates::agent_session_updates_router(state.clone());

    assert_eq!(
        updates(router.clone(), OWNER).await,
        serde_json::json!({
            "items": [{
                "sessionId": "0197d5c4-0000-7000-8000-000000000001",
                "sessionName": "Fix login",
                "harness": "cursor",
                "pullRequestUrl": null,
                "kind": "stalled",
                "summary": "No activity for over 20 minutes",
                "since": "2026-11-01T10:00:00Z",
                "options": [],
            }],
            "truncated": false,
            "truncationNotice": null,
        })
    );
    assert_eq!(
        updates(router, STRANGER).await,
        serde_json::json!({ "items": [], "truncated": false, "truncationNotice": null })
    );
    assert_eq!(
        *state.service.asked_for.lock().unwrap(),
        vec![OWNER.to_owned(), STRANGER.to_owned()]
    );
}
