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

mod approve_pairing {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, header},
    };
    use macro_authorization::{
        CODE_EXECUTION_HEADER, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
        ValidatedCredential,
    };
    use macro_user_id::user_id::MacroUserIdStr;
    use model_user::UserContext;
    use rootcause::Report;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    /// "person" is the user's own session; "agent" is their credential
    /// signed for an agent's program.
    #[derive(Clone)]
    struct Credentials;

    impl MacroAuthorizationService for Credentials {
        async fn authorize(
            &self,
            jwt: &str,
        ) -> Result<UserContext, Report<MacroAuthorizationError>> {
            match jwt {
                "person" | "agent" => Ok(UserContext {
                    user_id: "macro|person@example.com".to_owned(),
                    fusion_user_id: "fusion-user-id".to_owned(),
                    organization_id: None,
                    permissions: None,
                }),
                _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
            }
        }

        async fn authorize_identity(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            let mut credential = ValidatedCredential::session(self.authorize(jwt).await?);
            if jwt == "agent" {
                credential.origin = CredentialOrigin::MacroApiJwt;
                credential.identity.agent_id =
                    Some(serde_json::from_value(serde_json::json!(Uuid::from_u128(1))).unwrap());
            }
            Ok(credential)
        }

        async fn authorize_internal(
            &self,
            _provided_key: &str,
            _claims: InternalIdentityClaims,
        ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }

    /// Counts approvals that reach it, answering each "not found"; nothing
    /// else is asked.
    #[derive(Default, Clone)]
    struct Pairings {
        approvals: Arc<AtomicUsize>,
    }

    impl HarnessService for Pairings {
        async fn create_pairing(
            &self,
            _req: CreatePairingRequest,
        ) -> Result<CreatedPairing, HarnessError> {
            panic!("unexpected create_pairing call")
        }

        async fn get_pairing(&self, _code: &str) -> Result<PairingDetails, HarnessError> {
            panic!("unexpected get_pairing call")
        }

        async fn approve_pairing(
            &self,
            _caller: MacroUserIdStr<'static>,
            _code: &str,
            _req: ApprovePairingRequest,
        ) -> Result<Harness, HarnessError> {
            self.approvals.fetch_add(1, Ordering::SeqCst);
            Err(HarnessError::NotFound("pairing".to_owned()))
        }

        async fn claim_pairing(
            &self,
            _pairing_id: Uuid,
            _req: ClaimPairingRequest,
        ) -> Result<ClaimOutcome, HarnessError> {
            panic!("unexpected claim_pairing call")
        }

        async fn list_harnesses(
            &self,
            _caller: MacroUserIdStr<'static>,
        ) -> Result<Vec<Harness>, HarnessError> {
            panic!("unexpected list_harnesses call")
        }

        async fn list_directory(
            &self,
            _caller: MacroUserIdStr<'static>,
        ) -> Result<Vec<Harness>, HarnessError> {
            panic!("unexpected list_directory call")
        }

        async fn set_team_access(
            &self,
            _caller: MacroUserIdStr<'static>,
            _harness_id: HarnessId,
            _req: SetHarnessTeamAccessRequest,
        ) -> Result<(), HarnessError> {
            panic!("unexpected set_team_access call")
        }

        async fn list_residents(
            &self,
            _caller: MacroUserIdStr<'static>,
            _harness_id: HarnessId,
        ) -> Result<Vec<HarnessResident>, HarnessError> {
            panic!("unexpected list_residents call")
        }

        async fn patch_harness(
            &self,
            _caller: MacroUserIdStr<'static>,
            _harness_id: HarnessId,
            _req: PatchHarnessRequest,
        ) -> Result<Harness, HarnessError> {
            panic!("unexpected patch_harness call")
        }

        async fn delete_harness(
            &self,
            _caller: MacroUserIdStr<'static>,
            _harness_id: HarnessId,
        ) -> Result<(), HarnessError> {
            panic!("unexpected delete_harness call")
        }

        async fn list_bound_agents(
            &self,
            _harness_id: HarnessId,
        ) -> Result<Vec<HarnessAgent>, HarnessError> {
            panic!("unexpected list_bound_agents call")
        }

        async fn get_self(&self, _harness_id: HarnessId) -> Result<Harness, HarnessError> {
            panic!("unexpected get_self call")
        }

        async fn delete_self(&self, _harness_id: HarnessId) -> Result<(), HarnessError> {
            panic!("unexpected delete_self call")
        }

        async fn list_sessions(
            &self,
            _harness_id: HarnessId,
        ) -> Result<Vec<HarnessSession>, HarnessError> {
            panic!("unexpected list_sessions call")
        }
    }

    fn approve(bearer: &str, code_mode: bool) -> Request<Body> {
        let request = Request::post("/harness-pairings/ABCD-1234/approve")
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .header(header::CONTENT_TYPE, "application/json");
        let request = if code_mode {
            request.header(CODE_EXECUTION_HEADER, "1")
        } else {
            request
        };
        request.body(Body::from("{}")).unwrap()
    }

    async fn send(pairings: Pairings, request: Request<Body>) -> axum::response::Response {
        harnesses_router::<_, _, ()>(HarnessesRouterState::new(
            pairings,
            MacroAuthorizationState::new(Arc::new(Credentials)),
        ))
        .oneshot(request)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn an_agents_program_cannot_approve_a_pairing() {
        for request in [approve("agent", false), approve("person", true)] {
            let pairings = Pairings::default();
            let response = send(pairings.clone(), request).await;

            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["message"], PROGRAM_PAIRING_REFUSAL);
            assert_eq!(pairings.approvals.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn a_person_still_approves_a_pairing() {
        let pairings = Pairings::default();
        let response = send(pairings.clone(), approve("person", false)).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(pairings.approvals.load(Ordering::SeqCst), 1);
    }
}
