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

const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam@agents.example.com";
const TEAM_ID: Uuid = Uuid::from_u128(42);

/// Records what each route asked of the service.
#[derive(Default)]
struct FakeService {
    calls: Mutex<Vec<String>>,
}

impl FakeService {
    fn record(&self, call: String) {
        self.calls.lock().expect("lock").push(call);
    }
}

impl AgentSecretService for FakeService {
    async fn put(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
        value: String,
    ) -> Result<AgentSecretSummary, AgentSecretError> {
        self.record(format!("put {caller} {name} {value}"));
        Ok(AgentSecretSummary {
            name: name.to_string(),
            created_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            updated_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        })
    }

    async fn get(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<AgentSecret, AgentSecretError> {
        self.record(format!("get {caller} {name}"));
        Ok(AgentSecret {
            name: name.to_string(),
            value: "ghp_abc".to_string(),
            updated_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        })
    }

    async fn delete(
        &self,
        caller: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<(), AgentSecretError> {
        self.record(format!("delete {caller} {name}"));
        Ok(())
    }

    async fn list_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<AgentSecretSummaries, AgentSecretError> {
        self.record(format!(
            "list {} {agent_user_id}",
            receipt.entity().entity_id
        ));
        Ok(AgentSecretSummaries { secrets: vec![] })
    }

    async fn delete_for_admin(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<(), AgentSecretError> {
        self.record(format!(
            "admin delete {} {agent_user_id} {name}",
            receipt.entity().entity_id
        ));
        Ok(())
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
    agent_secrets_router(AgentSecretsRouterState {
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
async fn an_agent_stores_and_reads_its_own_secret() {
    let service = Arc::new(FakeService::default());

    let put = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::put("/me/secrets/github-token")
                .header(header::AUTHORIZATION, "Bearer agent")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"value":"ghp_abc"}"#))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(put.status(), StatusCode::OK);
    assert_eq!(
        body_text(put).await,
        r#"{"name":"github-token","createdAt":"2023-11-14T22:13:20Z","updatedAt":"2023-11-14T22:13:20Z"}"#
    );

    let get = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::get("/me/secrets/github-token")
                .header(header::AUTHORIZATION, "Bearer agent")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(get.status(), StatusCode::OK);
    assert_eq!(
        body_text(get).await,
        r#"{"name":"github-token","value":"ghp_abc","updatedAt":"2023-11-14T22:13:20Z"}"#
    );

    let delete = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::delete("/me/secrets/github-token")
                .header(header::AUTHORIZATION, "Bearer agent")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec![
            "put macro|sam@agents.example.com github-token ghp_abc".to_string(),
            "get macro|sam@agents.example.com github-token".to_string(),
            "delete macro|sam@agents.example.com github-token".to_string(),
        ]
    );
}

#[tokio::test]
async fn secrets_need_credentials() {
    let service = Arc::new(FakeService::default());

    let response = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::get("/me/secrets/github-token")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn an_admin_lists_and_deletes_an_agents_secrets() {
    let service = Arc::new(FakeService::default());

    let list = router(service.clone(), TeamRole::Admin)
        .oneshot(
            Request::get("/macro%7Csam%40agents.example.com/secrets")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(list.status(), StatusCode::OK);
    assert_eq!(body_text(list).await, r#"{"secrets":[]}"#);

    let delete = router(service.clone(), TeamRole::Admin)
        .oneshot(
            Request::delete("/macro%7Csam%40agents.example.com/secrets/github-token")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    let member = router(service.clone(), TeamRole::Member)
        .oneshot(
            Request::get("/macro%7Csam%40agents.example.com/secrets")
                .header(header::AUTHORIZATION, "Bearer admin")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    assert_eq!(member.status(), StatusCode::UNAUTHORIZED);

    assert_eq!(
        *service.calls.lock().expect("lock"),
        vec![
            "list 00000000-0000-0000-0000-00000000002a macro|sam@agents.example.com".to_string(),
            "admin delete 00000000-0000-0000-0000-00000000002a macro|sam@agents.example.com github-token"
                .to_string(),
        ]
    );
}
