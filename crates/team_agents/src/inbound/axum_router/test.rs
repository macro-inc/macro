use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
    EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::models::{BillingInterval, TeamAgentStatus};

const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam@agents.example.com";
const TEAM_ID: Uuid = Uuid::from_u128(42);

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .map(MacroUserIdStr::into_owned)
        .expect("valid user id")
}

fn agent() -> TeamAgent {
    TeamAgent {
        user_id: user(AGENT),
        team_id: TEAM_ID,
        name: "Sam".to_string(),
        email: "sam@agents.example.com".to_string(),
        created_by: Some(user(ADMIN)),
        computer_id: None,
        status: TeamAgentStatus::Provisioning,
        status_reason: None,
        setup: None,
        created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
    }
}

/// Records what each route asked of the service.
#[derive(Default)]
struct FakeService {
    calls: Mutex<Vec<String>>,
    create_error: Mutex<Option<TeamAgentError>>,
    retry_error: Mutex<Option<TeamAgentError>>,
}

impl FakeService {
    fn record(&self, call: String) {
        self.calls.lock().expect("lock").push(call);
    }
}

impl TeamAgentService for FakeService {
    async fn quote(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        size: ComputerSize,
    ) -> Result<TeamAgentQuote, TeamAgentError> {
        self.record(format!("quote {} {size:?}", receipt.entity().entity_id));
        Ok(TeamAgentQuote {
            vcpus: 8,
            memory_gb: 16,
            disk_gb: 200,
            seat: 4000,
            computer: 5000,
            total: 9000,
            currency: "usd".to_string(),
            interval: BillingInterval::Month,
        })
    }

    async fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> Result<TeamAgent, TeamAgentError> {
        self.record(format!(
            "create {} {} {:?}",
            receipt.entity().entity_id,
            request.name,
            request.size
        ));

        match self.create_error.lock().expect("lock").take() {
            Some(error) => Err(error),
            None => Ok(agent()),
        }
    }

    async fn list(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<TeamAgents, TeamAgentError> {
        self.record(format!("list {}", receipt.entity().entity_id));
        Ok(TeamAgents {
            agents: vec![agent()],
        })
    }

    async fn retry(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamAgent, TeamAgentError> {
        self.record(format!(
            "retry {} {agent_user_id}",
            receipt.entity().entity_id
        ));
        match self.retry_error.lock().expect("lock").take() {
            Some(error) => Err(error),
            None => Ok(agent()),
        }
    }

    async fn delete(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        self.record(format!(
            "delete {} {agent_user_id}",
            receipt.entity().entity_id
        ));
        Ok(())
    }

    async fn me(&self, caller: &MacroUserIdStr<'_>) -> Result<TeamAgent, TeamAgentError> {
        self.record(format!("me {caller}"));
        Err(TeamAgentError::NotAnAgent)
    }

    async fn list_email(
        &self,
        _caller: &MacroUserIdStr<'_>,
        _limit: u8,
    ) -> Result<EmailMessages, TeamAgentError> {
        panic!("unexpected list_email call")
    }

    async fn get_email(
        &self,
        _caller: &MacroUserIdStr<'_>,
        _message_id: &str,
    ) -> Result<EmailMessage, TeamAgentError> {
        panic!("unexpected get_email call")
    }

    async fn send_email(
        &self,
        _caller: &MacroUserIdStr<'_>,
        _email: SendEmail,
    ) -> Result<SentEmail, TeamAgentError> {
        panic!("unexpected send_email call")
    }
}

#[derive(Clone)]
struct FakeEntityAccessService {
    role: TeamRole,
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
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
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
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(Some(UserTeamInfo {
            team_id: TEAM_ID,
            role: self.role,
        }))
    }
}

/// `Bearer admin` and `Bearer agent` authenticate as those users.
#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        let user_id = match jwt {
            "admin" => ADMIN,
            "agent" => AGENT,
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };

        Ok(UserContext {
            user_id: user_id.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            organization_id: None,
            permissions: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn router(service: Arc<FakeService>, role: TeamRole) -> Router {
    team_agents_router(TeamAgentsRouterState {
        service,
        entity_access_service: Arc::new(FakeEntityAccessService { role }),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    })
}

async fn body_text(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body should be readable");
    String::from_utf8(body.to_vec()).expect("body should be UTF-8")
}

#[tokio::test]
async fn an_admin_invites_an_agent() {
    let service = Arc::new(FakeService::default());

    let response = router(service.clone(), TeamRole::Admin)
        .oneshot(
            Request::post("/")
                .header(header::AUTHORIZATION, "Bearer admin")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"name":"Sam","jobDescription":"Books venues.","personality":"Warm.","size":"large","avatarUrl":null}"#,
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(
        body_text(response).await,
        r#"{"userId":"macro|sam@agents.example.com","teamId":"00000000-0000-0000-0000-00000000002a","name":"Sam","email":"sam@agents.example.com","createdBy":"macro|admin@example.com","computerId":null,"status":"provisioning","statusReason":null,"setup":null,"createdAt":"2023-11-14T22:13:20Z"}"#
    );
    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec!["create 00000000-0000-0000-0000-00000000002a Sam Large".to_string()]
    );
}

#[tokio::test]
async fn a_member_who_is_not_an_admin_cannot_invite_or_quote() {
    let service = Arc::new(FakeService::default());

    let create = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::post("/")
                .header(header::AUTHORIZATION, "Bearer admin")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"name":"Sam","jobDescription":"Books venues.","personality":"Warm.","size":"large"}"#,
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    let quote = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::get("/quote?size=standard")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(create.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(quote.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn quote_reads_the_size_from_the_query() {
    let service = Arc::new(FakeService::default());

    let response = router(service.clone(), TeamRole::Admin)
        .oneshot(
            Request::get("/quote?size=xl")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        body_text(response).await,
        r#"{"vcpus":8,"memoryGb":16,"diskGb":200,"seat":4000,"computer":5000,"total":9000,"currency":"usd","interval":"month"}"#
    );
    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec!["quote 00000000-0000-0000-0000-00000000002a Xl".to_string()]
    );

    let unknown_size = router(service, TeamRole::Admin)
        .oneshot(
            Request::get("/quote?size=huge")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(unknown_size.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn delete_takes_the_agent_from_the_path() {
    let service = Arc::new(FakeService::default());

    let response = router(service.clone(), TeamRole::Owner)
        .oneshot(
            Request::delete("/macro%7Csam%40agents.example.com")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec![
            "delete 00000000-0000-0000-0000-00000000002a macro|sam@agents.example.com".to_string()
        ]
    );
}

#[tokio::test]
async fn me_answers_for_the_calling_account() {
    let service = Arc::new(FakeService::default());

    let response = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::get("/me")
                .header(header::AUTHORIZATION, "Bearer agent")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec!["me macro|sam@agents.example.com".to_string()]
    );
}

#[tokio::test]
async fn a_computer_that_cannot_be_bought_answers_conflict() {
    let service = Arc::new(FakeService::default());
    *service.create_error.lock().expect("lock") =
        Some(TeamAgentError::ComputerUnavailable("sold out".to_string()));

    let response = router(service, TeamRole::Admin)
        .oneshot(
            Request::post("/")
                .header(header::AUTHORIZATION, "Bearer admin")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"name":"Sam","jobDescription":"Books venues.","personality":"Warm.","size":"standard"}"#,
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        body_text(response).await,
        r#"{"message":"the computer can't be bought: sold out"}"#
    );
}

#[tokio::test]
async fn a_billing_provider_failure_answers_bad_gateway_without_provider_details() {
    let service = Arc::new(FakeService::default());
    *service.create_error.lock().expect("lock") = Some(TeamAgentError::ComputerProvider(
        rootcause::report!("private provider details"),
    ));
    let response = router(service, TeamRole::Admin).oneshot(
        Request::post("/")
            .header(header::AUTHORIZATION, "Bearer admin")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"Agent","jobDescription":"Handle tasks","personality":"Direct","size":"standard"}"#))
            .expect("request"),
    ).await.expect("response");
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(
        !body_text(response)
            .await
            .contains("private provider details")
    );
}

#[tokio::test]
async fn retry_requires_an_admin_and_uses_the_agent_path() {
    let service = Arc::new(FakeService::default());
    for (role, expected) in [
        (TeamRole::Member, StatusCode::UNAUTHORIZED),
        (TeamRole::Admin, StatusCode::OK),
    ] {
        let response = router(service.clone(), role)
            .oneshot(
                Request::post("/macro%7Csam%40agents.example.com/retry")
                    .header(header::AUTHORIZATION, "Bearer admin")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec!["retry 00000000-0000-0000-0000-00000000002a macro|sam@agents.example.com"]
    );
}

#[tokio::test]
async fn retry_returns_conflict_when_the_computer_is_not_failed() {
    let service = Arc::new(FakeService::default());
    *service.retry_error.lock().unwrap() = Some(TeamAgentError::RetryUnavailable(
        "only failed computers can be retried".to_string(),
    ));
    let response = router(service, TeamRole::Admin)
        .oneshot(
            Request::post("/macro%7Csam%40agents.example.com/retry")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(
        body_text(response)
            .await
            .contains("only failed computers can be retried")
    );
}
