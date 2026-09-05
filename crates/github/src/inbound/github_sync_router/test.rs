use std::sync::{Arc, Mutex};

use axum::{Router, http::Request};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_service_urls::AppServiceUrl;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use rootcause::Report;
use tower::util::ServiceExt;
use uuid::Uuid;

use crate::domain::{
    models::{
        GithubError, GithubInstallationAccessToken, InstallationState, ValidatedGithubWebhookEvent,
    },
    ports::GithubSyncService,
};

use super::{GithubSyncRouterState, github_sync_router};

const USER_ID: &str = "macro|github-installer@example.com";

#[derive(Clone)]
struct TestAuthorizationService;

impl MacroAuthorizationService for TestAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: USER_ID.to_string(),
            fusion_user_id: "fusion-github-installer".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[derive(Clone, Copy)]
struct TestEntityAccessService {
    team_id: Option<Uuid>,
}

impl EntityAccessService for TestEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(self.team_id.map(|team_id| UserTeamInfo {
            team_id,
            role: TeamRole::Member,
        }))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BeginCall {
    macro_user_id: String,
    team_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompleteCall {
    state: String,
    code: Option<String>,
    installation_id: Option<u64>,
    setup_action: String,
}

struct MockGithubSyncService {
    begin_calls: Arc<Mutex<Vec<BeginCall>>>,
    complete_calls: Arc<Mutex<Vec<CompleteCall>>>,
}

impl MockGithubSyncService {
    fn new() -> Self {
        Self {
            begin_calls: Arc::new(Mutex::new(Vec::new())),
            complete_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn begin_calls(&self) -> Vec<BeginCall> {
        self.begin_calls.lock().unwrap().clone()
    }

    fn complete_calls(&self) -> Vec<CompleteCall> {
        self.complete_calls.lock().unwrap().clone()
    }
}

impl GithubSyncService for MockGithubSyncService {
    async fn validate_webhook_event(
        &self,
        _event_type: &str,
        _signature: &str,
        _body: &[u8],
    ) -> Result<ValidatedGithubWebhookEvent, GithubError> {
        unimplemented!()
    }

    async fn process_webhook_event(
        &self,
        _webhook_event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        unimplemented!()
    }

    async fn begin_installation_setup(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
        team_id: Option<Uuid>,
    ) -> Result<String, GithubError> {
        self.begin_calls.lock().unwrap().push(BeginCall {
            macro_user_id: macro_user_id.to_string(),
            team_id,
        });
        Ok("https://github.com/apps/my-sync-app/installations/new?state=signed".to_string())
    }

    async fn complete_installation_setup(
        &self,
        state: &str,
        code: Option<&str>,
        installation_id: Option<u64>,
        setup_action: &str,
    ) -> Result<(), GithubError> {
        self.complete_calls.lock().unwrap().push(CompleteCall {
            state: state.to_string(),
            code: code.map(str::to_string),
            installation_id,
            setup_action: setup_action.to_string(),
        });

        if matches!(state, "" | "malformed" | "ownership-failure")
            || !matches!(setup_action, "install" | "update" | "request")
            || (setup_action != "request" && (code.is_none() || installation_id.is_none()))
        {
            return Err(GithubError::InvalidInstallationState);
        }

        Ok(())
    }

    fn get_github_sync_app_url(&self) -> &str {
        "https://github.com/apps/my-sync-app/installations/new"
    }

    async fn generate_installation_access_token(
        &self,
        _installation_id: u64,
    ) -> Result<GithubInstallationAccessToken, GithubError> {
        unimplemented!()
    }
}

fn mock_router() -> (Router, Arc<MockGithubSyncService>) {
    mock_router_with_team(None)
}

fn mock_router_with_team(team_id: Option<Uuid>) -> (Router, Arc<MockGithubSyncService>) {
    let service = Arc::new(MockGithubSyncService::new());
    let router = github_sync_router(GithubSyncRouterState {
        service: service.clone(),
        entity_access_service: Arc::new(TestEntityAccessService { team_id }),
        authorization_state: MacroAuthorizationState::new(Arc::new(TestAuthorizationService)),
    });
    (router, service)
}

fn request(uri: &str) -> Request<axum::body::Body> {
    Request::builder()
        .uri(uri)
        .body(axum::body::Body::empty())
        .unwrap()
}

fn authenticated_request(uri: &str) -> Request<axum::body::Body> {
    Request::builder()
        .uri(uri)
        .header("authorization", "Bearer valid")
        .body(axum::body::Body::empty())
        .unwrap()
}

fn callback_state(team_id: Option<Uuid>) -> String {
    let state = InstallationState {
        macro_user_id: MacroUserIdStr::try_from(USER_ID.to_string()).unwrap(),
        team_id,
        exp: i64::MAX,
    };
    let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&state).unwrap());
    format!("{payload}.test-signature")
}

fn app_url() -> String {
    AppServiceUrl::unwrap_new().as_str().to_string()
}

#[tokio::test]
async fn install_sync_rejects_unauthenticated_requests() {
    let (router, service) = mock_router();

    let response = router.oneshot(request("/install-sync")).await.unwrap();

    assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
    assert!(service.begin_calls().is_empty());
}

#[tokio::test]
async fn install_sync_uses_the_authenticated_users_optional_team() {
    let team_id = Uuid::new_v4();
    let (personal_router, personal_service) = mock_router();
    let (team_router, team_service) = mock_router_with_team(Some(team_id));

    let personal_response = personal_router
        .oneshot(authenticated_request("/install-sync"))
        .await
        .unwrap();
    let team_response = team_router
        .oneshot(authenticated_request("/install-sync"))
        .await
        .unwrap();

    assert_eq!(
        personal_response.status(),
        axum::http::StatusCode::TEMPORARY_REDIRECT
    );
    assert_eq!(
        team_response.status(),
        axum::http::StatusCode::TEMPORARY_REDIRECT
    );
    assert_eq!(
        personal_service.begin_calls(),
        vec![BeginCall {
            macro_user_id: USER_ID.to_string(),
            team_id: None,
        }]
    );
    assert_eq!(
        team_service.begin_calls(),
        vec![BeginCall {
            macro_user_id: USER_ID.to_string(),
            team_id: Some(team_id),
        }]
    );
}

#[tokio::test]
async fn install_sync_does_not_accept_team_context_from_the_query() {
    let (router, service) = mock_router();

    let response = router
        .oneshot(authenticated_request(
            "/install-sync?team_id=00000000-0000-0000-0000-000000000001",
        ))
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        axum::http::StatusCode::TEMPORARY_REDIRECT
    );
    assert_eq!(service.begin_calls()[0].team_id, None);
}

#[tokio::test]
async fn successful_callbacks_redirect_to_the_matching_destination() {
    let (router, _) = mock_router();
    let personal_state = callback_state(None);
    let team_state = callback_state(Some(Uuid::new_v4()));

    let personal = router
        .clone()
        .oneshot(request(&format!(
            "/sync-redirect?state={personal_state}&code=code&installation_id=1&setup_action=install"
        )))
        .await
        .unwrap();
    let team = router
        .oneshot(request(&format!(
            "/sync-redirect?state={team_state}&code=code&installation_id=2&setup_action=update"
        )))
        .await
        .unwrap();

    assert_eq!(
        personal
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap(),
        app_url()
    );
    assert_eq!(
        team.headers().get("location").unwrap().to_str().unwrap(),
        format!(
            "{}/app/settings/connections",
            app_url().trim_end_matches('/')
        )
    );
}

#[tokio::test]
async fn request_callback_without_installation_id_redirects_to_the_app() {
    let (router, service) = mock_router();
    let state = callback_state(Some(Uuid::new_v4()));

    let response = router
        .oneshot(request(&format!(
            "/sync-redirect?state={state}&setup_action=request"
        )))
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        axum::http::StatusCode::TEMPORARY_REDIRECT
    );
    assert_eq!(
        response
            .headers()
            .get("location")
            .unwrap()
            .to_str()
            .unwrap(),
        app_url()
    );
    assert_eq!(service.complete_calls()[0].installation_id, None);
}

#[tokio::test]
async fn degraded_callbacks_always_return_a_temporary_redirect() {
    let (router, _) = mock_router();
    let state = callback_state(None);
    let cases = [
        "/sync-redirect".to_string(),
        "/sync-redirect?state=malformed&setup_action=install".to_string(),
        format!(
            "/sync-redirect?state={state}&code=code&installation_id=invalid&setup_action=install"
        ),
        "/sync-redirect?state=ownership-failure&code=code&installation_id=3&setup_action=install"
            .to_string(),
        format!("/sync-redirect?state={state}&setup_action=unknown"),
    ];

    for uri in cases {
        let response = router.clone().oneshot(request(&uri)).await.unwrap();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::TEMPORARY_REDIRECT,
            "callback {uri} did not degrade to a redirect"
        );
        assert_eq!(
            response
                .headers()
                .get("location")
                .unwrap()
                .to_str()
                .unwrap(),
            app_url()
        );
    }
}

#[tokio::test]
async fn wrong_path_returns_not_found() {
    let (router, _) = mock_router();

    let response = router.oneshot(request("/wrong-path")).await.unwrap();

    assert_eq!(response.status(), axum::http::StatusCode::NOT_FOUND);
}
