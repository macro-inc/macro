use axum::http::HeaderValue;
use chrono::Utc;

use super::*;
use crate::domain::models::{ClaudeMode, HarnessOwner};

fn harness(connected: bool) -> Harness {
    Harness {
        id: HarnessId::TEST_A,
        allow_permission_bypass: false,
        kind: "macrod".to_owned(),
        name: "desk".to_owned(),
        owner: HarnessOwner::User {
            user_id: "macro|owner@example.com".to_owned(),
        },
        access: crate::domain::models::HarnessAccess::None,
        shared_team_ids: Vec::new(),
        created_by: "macro|owner@example.com".to_owned(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        connected,
        last_connected_at: None,
        computer_id: None,
        team_agent_user_id: None,
        claude_mode: ClaudeMode::MacroCredits,
    }
}

#[test]
fn only_a_daemon_holding_a_connection_can_disagree_with_offline() {
    let mut holding = HeaderMap::new();
    holding.insert(RUNTIME_CONNECTED_HEADER, HeaderValue::from_static("true"));

    assert!(runtime_presence_disagrees(&holding, &harness(false)));
    assert!(!runtime_presence_disagrees(&holding, &harness(true)));
    assert!(!runtime_presence_disagrees(
        &HeaderMap::new(),
        &harness(false)
    ));
}

mod approve_pairing_route {
    use super::*;
    use crate::domain::ports::MockHarnessService;
    use axum::body::Body;
    use axum::http::Request;
    use macro_authorization::{
        CredentialOrigin, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
        MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
        NoUserApiKeyAuthorizer, ValidatedCredential, ValidatedIdentity,
    };
    use rootcause::Report;
    use tower::ServiceExt;

    const PERSON: &str = "macro|owner@example.com";

    /// A bearer `agent:` or `routine:` stands for a Macro API JWT signed for
    /// an agent or a routine run; any other bearer is a person's session.
    #[derive(Clone)]
    struct Validator;

    impl JwtValidator for Validator {
        fn validate_credential(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            let agent = jwt.strip_prefix("agent:");
            let routine = jwt.strip_prefix("routine:");
            let user_id = agent.or(routine).unwrap_or(jwt);
            Ok(ValidatedCredential {
                origin: if user_id == jwt {
                    CredentialOrigin::Session
                } else {
                    CredentialOrigin::MacroApiJwt
                },
                identity: ValidatedIdentity {
                    agent_id: agent.map(|_| bot_id::MACRO_AI_BOT_ID),
                    agent_via: None,
                    routine_id: routine.map(|_| uuid::Uuid::nil()),
                    user_id: user_id.to_owned(),
                    fusion_user_id: "fusion-user".to_owned(),
                    organization_id: None,
                    permissions: None,
                },
            })
        }
    }

    fn router(service: MockHarnessService) -> axum::Router {
        let authorization =
            MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
                Validator,
                InternalAuthConfig {
                    api_key: "test-internal-key".to_owned(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            )));
        harnesses_router(HarnessesRouterState::new(service, authorization))
    }

    fn approve(bearer: &str) -> Request<Body> {
        Request::post("/harness-pairings/ABCD-1234/approve")
            .header("authorization", format!("Bearer {bearer}"))
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap()
    }

    /// Approving lets the daemon claim a long-lived harness token, so only a
    /// person approves: a program's signed agent or routine claim refuses it
    /// even without the code-mode header.
    #[tokio::test]
    async fn a_program_cannot_approve_a_pairing() {
        let mut header_only = approve(PERSON);
        header_only.headers_mut().insert(
            macro_authorization::CODE_EXECUTION_HEADER,
            HeaderValue::from_static("1"),
        );
        for (program, request) in [
            ("an agent run", approve(&format!("agent:{PERSON}"))),
            (
                "an owner-identity routine run",
                approve(&format!("routine:{PERSON}")),
            ),
            ("the code-mode runtime", header_only),
        ] {
            let mut service = MockHarnessService::new();
            service.expect_approve_pairing().never();

            let response = router(service).oneshot(request).await.unwrap();

            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{program}");
        }
    }

    #[tokio::test]
    async fn a_person_approves_a_pairing() {
        let mut service = MockHarnessService::new();
        service
            .expect_approve_pairing()
            .times(1)
            .returning(|_, _, _| Box::pin(async { Ok(harness(false)) }));

        let response = router(service).oneshot(approve(PERSON)).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
