use super::*;

#[tokio::test]
async fn computers_not_sold_answers_service_unavailable() {
    let response = ComputersHttpError::from(ComputerError::Billing(BillingError::NotAvailable))
        .into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["message"],
        "computers are not available in this environment"
    );
}

use crate::domain::fakes::TEAM;
use crate::domain::service::test::availability::{assert_no_http_work, detached_router_service};
use axum::{
    body::Body,
    http::{Method, Request},
};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityPermission, EntityType,
    TeamRole, UserTeamInfo,
};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

#[derive(Clone)]
struct Authorization;
impl MacroAuthorizationService for Authorization {
    async fn authorize(&self, _jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: "macro|admin@example.com".to_owned(),
            fusion_user_id: Uuid::from_u128(1).to_string(),
            permissions: None,
            organization_id: None,
        })
    }
    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }
    async fn authorize_internal(
        &self,
        provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key == "test-internal-key" {
            Ok(None)
        } else {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }
}

#[derive(Clone)]
struct TeamAccess;
impl EntityAccessService for TeamAccess {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("unused access method")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!("unused access method")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unimplemented!("unused access method")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Ok(Vec::new())
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Ok(None)
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(Some(UserTeamInfo {
            team_id: TEAM,
            role: TeamRole::Admin,
        }))
    }
}

#[tokio::test]
async fn registered_routes_reject_detached_fleet_without_side_effects() {
    for comped in [false, true] {
        let (service, id) = detached_router_service(comped, true).await;
        let state = ComputerRouterState {
            service: service.clone(),
            entity_access_service: Arc::new(TeamAccess),
            authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
        };
        let router: Router = team_router(state.clone()).nest("/internal", internal_router(state));
        let internal_purchase = serde_json::json!({"billing": {"kind": "stripe"}, "teamId": TEAM,
            "createdBy": "macro|admin@example.com", "size": "standard"})
        .to_string();
        for (method, path, body) in [
            (
                Method::POST,
                "/team/computers".to_owned(),
                r#"{"size":"standard"}"#.to_owned(),
            ),
            (
                Method::GET,
                "/team/computers/quote?size=standard".to_owned(),
                String::new(),
            ),
            (
                Method::GET,
                "/team/computers/offers".to_owned(),
                String::new(),
            ),
            (Method::GET, "/team/computers".to_owned(), String::new()),
            (Method::GET, format!("/team/computers/{id}"), String::new()),
            (
                Method::GET,
                format!("/team/computers/{}", Uuid::now_v7()),
                String::new(),
            ),
            (
                Method::POST,
                "/team/computers/notify".to_owned(),
                r#"{"size":"standard"}"#.to_owned(),
            ),
            (
                Method::POST,
                format!("/team/computers/{id}/power"),
                r#"{"on":true}"#.to_owned(),
            ),
            (
                Method::POST,
                format!("/team/computers/{id}/retry"),
                String::new(),
            ),
            (
                Method::POST,
                format!("/team/computers/{id}/cancel"),
                String::new(),
            ),
            (
                Method::DELETE,
                format!("/team/computers/{id}/cancel"),
                String::new(),
            ),
            (
                Method::POST,
                format!("/team/computers/{id}/release"),
                r#"{"confirmName":"Build box"}"#.to_owned(),
            ),
            (
                Method::POST,
                "/internal/computers".to_owned(),
                internal_purchase,
            ),
            (
                Method::GET,
                format!("/internal/computers/quote?teamId={TEAM}&size=standard"),
                String::new(),
            ),
            (
                Method::GET,
                format!("/internal/computers/{id}?teamId={TEAM}"),
                String::new(),
            ),
        ] {
            let mut request = Request::builder()
                .method(method)
                .uri(&path)
                .header("content-type", "application/json");
            if path.starts_with("/internal") {
                request = request.header(
                    macro_authorization::INTERNAL_API_KEY_HEADER,
                    "test-internal-key",
                );
            } else {
                request = request.header("authorization", "Bearer test-user");
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::from(body)).unwrap())
                .await
                .unwrap();
            let status = response.status();
            let body = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            assert_eq!(
                status,
                StatusCode::SERVICE_UNAVAILABLE,
                "{path}: {}",
                String::from_utf8_lossy(&body)
            );
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                body,
                serde_json::json!({"message": "computers are not available"})
            );
            assert_no_http_work(&service);
        }
    }
}

#[tokio::test]
async fn registered_routes_preserve_rollout_and_internal_authentication_denials() {
    let (service, id) = detached_router_service(false, false).await;
    let state = ComputerRouterState {
        service: service.clone(),
        entity_access_service: Arc::new(TeamAccess),
        authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
    };
    let router: Router = team_router(state.clone()).nest("/internal", internal_router(state));
    for (method, path, body) in [
        (Method::POST, "/team/computers", r#"{"size":"standard"}"#),
        (Method::GET, "/team/computers/quote?size=standard", ""),
        (Method::GET, "/team/computers/offers", ""),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", "Bearer test-user")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    for path in [
        "/internal/computers".to_owned(),
        format!("/internal/computers/quote?teamId={TEAM}&size=standard"),
        format!("/internal/computers/{id}?teamId={TEAM}"),
    ] {
        let method = if path == "/internal/computers" {
            Method::POST
        } else {
            Method::GET
        };
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", "Bearer test-user")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    assert_no_http_work(&service);
}
