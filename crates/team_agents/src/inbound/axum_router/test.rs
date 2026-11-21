use super::*;
use crate::domain::{
    models::{ComputerId, ComputerSize, TeamAgents},
    voice::AgentVoice,
};
use axum::{
    body::Body,
    http::{Request, header},
};
use entity_access::domain::models::{
    AccessError, AccessLevel, AdminTeamRole, BotAccessScope, BotId, CallChannelInfo,
    EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole, RequiredPermission,
    TeamRole, UserTeamInfo,
};
use hosted_runtimes::domain::{
    agent::{AgentEnrollment, AgentEnrollmentError},
    enrollment::EnrollmentGeneration,
};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use rootcause::Report;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

const USER_ID: &str = "macro|admin@example.com";
const TEAM_ID: uuid::Uuid = uuid::Uuid::from_u128(42);

/// Counts every call and answers it with `NotFound`, so a request the route
/// let through shows as 404.
#[derive(Default)]
struct Reached(AtomicUsize);

impl Reached {
    fn reached<T>(&self) -> Result<T, TeamAgentError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(TeamAgentError::NotFound)
    }
}

impl TeamAgentService for Reached {
    async fn create(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: CreateTeamAgent,
    ) -> Result<TeamAgent, TeamAgentError> {
        self.reached()
    }
    async fn list(
        &self,
        _: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<TeamAgents, TeamAgentError> {
        self.reached()
    }
    async fn delete(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.reached()
    }
    async fn voice(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
    ) -> Result<AgentVoice, TeamAgentError> {
        self.reached()
    }
    async fn set_voice(
        &self,
        _: EntityAccessReceipt<AdminTeamRole>,
        _: &MacroUserIdStr<'_>,
        _: AgentVoice,
    ) -> Result<AgentVoice, TeamAgentError> {
        self.reached()
    }
    async fn agent_online(
        &self,
        _: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<(), TeamAgentError> {
        self.reached()
    }
    async fn issue_enrollment(
        &self,
        _: ComputerId,
        _: EnrollmentGeneration,
    ) -> Result<Option<AgentEnrollment>, AgentEnrollmentError> {
        unreachable!("not a route")
    }
}

/// `valid` is a person's session; `agent` and `routine` stand for a Macro
/// API JWT signed for an agent or a routine run, as the same user.
#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if matches!(jwt, "valid" | "agent" | "routine") {
            return Ok(UserContext {
                user_id: USER_ID.to_owned(),
                fusion_user_id: "fusion-user-id".to_owned(),
                organization_id: None,
                permissions: None,
            });
        }
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        let context = self.authorize(jwt).await?;
        let mut credential = macro_authorization::ValidatedCredential::session(context);
        match jwt {
            "agent" => {
                credential.origin = macro_authorization::CredentialOrigin::MacroApiJwt;
                credential.identity.agent_id = Some(bot_id::MACRO_AI_BOT_ID);
            }
            "routine" => {
                credential.origin = macro_authorization::CredentialOrigin::MacroApiJwt;
                credential.identity.routine_id = Some(uuid::Uuid::nil());
            }
            _ => {}
        }
        Ok(credential)
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[derive(Clone, Default)]
struct FakeEntityAccessService {
    membership: Option<(String, TeamRole)>,
}

impl FakeEntityAccessService {
    fn with_membership(user_id: &str, role: TeamRole) -> Self {
        Self {
            membership: Some((user_id.to_string(), role)),
        }
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_entity_access_receipt call")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_bot_entity_access_receipt call")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected get_access_level call")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        let Some((member_id, role)) = &self.membership else {
            return Ok(None);
        };
        if member_id != user_id.as_ref() {
            return Ok(None);
        }
        Ok(Some(UserTeamInfo {
            team_id: TEAM_ID,
            role: *role,
        }))
    }
}

fn router(service: Arc<Reached>) -> axum::Router {
    team_agents_router(TeamAgentsRouterState {
        service,
        entity_access_service: Arc::new(FakeEntityAccessService::with_membership(
            USER_ID,
            TeamRole::Owner,
        )),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    })
}

fn create(bearer: &str, code_execution: bool) -> Request<Body> {
    let mut request = Request::post("/")
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::CONTENT_TYPE, "application/json");
    if code_execution {
        request = request.header(macro_authorization::CODE_EXECUTION_HEADER, "1");
    }
    request
        .body(Body::from(
            r#"{"purchaseKey": "k", "name": "Ada", "jobDescription": "j", "personality": "p", "size": "standard"}"#,
        ))
        .unwrap()
}

/// Creating an agent teammate adds a member to the team, mints its key and
/// buys a computer: only a person does that, whatever a program's
/// credential or the code-mode header says.
#[tokio::test]
async fn a_program_cannot_create_a_team_agent() {
    for (program, bearer, code_execution) in [
        ("an agent run", "agent", false),
        ("an owner-identity routine run", "routine", false),
        ("the code-mode runtime", "valid", true),
    ] {
        let service = Arc::new(Reached::default());

        let response = router(service.clone())
            .oneshot(create(bearer, code_execution))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{program}");
        assert_eq!(service.0.load(Ordering::SeqCst), 0, "{program}");
    }
}

#[tokio::test]
async fn a_person_creates_a_team_agent() {
    let service = Arc::new(Reached::default());

    let response = router(service.clone())
        .oneshot(create("valid", false))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(service.0.load(Ordering::SeqCst), 1);
}

async fn error_body(error: TeamAgentError) -> (StatusCode, serde_json::Value) {
    let response = error.into_response();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn no_room_is_a_coded_conflict_naming_the_size() {
    let (status, body) = error_body(TeamAgentError::NoRoom(ComputerSize::Large)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "no_room");
    assert_eq!(body["size"], "large");
}

#[tokio::test]
async fn a_declined_card_is_a_coded_payment_required() {
    let (status, body) = error_body(TeamAgentError::PaymentDeclined).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(body["code"], "payment_declined");
    assert!(body.get("size").is_none());
}

#[tokio::test]
async fn a_repeat_of_an_invite_in_flight_is_coded() {
    let (status, body) = error_body(TeamAgentError::InviteInProgress).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "invite_in_progress");
}

/// A bad purchase key reaches the service, which refuses it before creating
/// anything, and answers a 400 with a message, not the extractor's 422.
#[tokio::test]
async fn an_invalid_purchase_key_is_a_bad_request_with_a_message() {
    let service = Arc::new(Reached::default());
    let request = Request::post("/")
        .header(header::AUTHORIZATION, "Bearer valid")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            r#"{"purchaseKey": "has space", "name": "Ada", "size": "standard"}"#,
        ))
        .unwrap();

    let response = router(service.clone()).oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(service.0.load(Ordering::SeqCst), 1);

    let (status, body) = error_body(TeamAgentError::InvalidPurchaseKey).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["message"],
        "the purchase key must be 1 to 128 printable ASCII characters"
    );
    assert!(body.get("code").is_none());
}
