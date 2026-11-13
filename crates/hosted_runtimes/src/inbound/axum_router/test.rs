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

/// The web app shows a trial team why it cannot buy, so the error carries a
/// stable code beside its message.
#[tokio::test]
async fn a_trialing_team_gets_a_coded_forbidden() {
    let response =
        ComputersHttpError::from(ComputerError::Billing(BillingError::TeamOnTrial)).into_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["code"], "team_on_trial");
    assert_eq!(
        body["message"],
        "Computers are available on paid plans. Your team is on a trial."
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

/// The caller's role on the team.
#[derive(Clone)]
struct TeamAccess(TeamRole);
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
            role: self.0,
        }))
    }
}

#[tokio::test]
async fn registered_routes_reject_detached_fleet_without_side_effects() {
    for comped in [false, true] {
        let (service, id) = detached_router_service(comped, true).await;
        let state = ComputerRouterState {
            service: service.clone(),
            entity_access_service: Arc::new(TeamAccess(TeamRole::Admin)),
            authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
        };
        let router: Router = team_router(state);
        for (method, path, body) in [
            (
                Method::POST,
                "/team/computers".to_owned(),
                r#"{"size":"standard","purchaseKey":"buy-dialog-1"}"#.to_owned(),
            ),
            (
                Method::GET,
                "/team/computers/offers".to_owned(),
                String::new(),
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
        ] {
            let request = Request::builder()
                .method(method)
                .uri(&path)
                .header("content-type", "application/json")
                .header("authorization", "Bearer test-user");
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
async fn registered_routes_preserve_rollout_denials() {
    let (service, _) = detached_router_service(false, false).await;
    let state = ComputerRouterState {
        service: service.clone(),
        entity_access_service: Arc::new(TeamAccess(TeamRole::Admin)),
        authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
    };
    let router: Router = team_router(state);
    for (method, path, body) in [
        (
            Method::POST,
            "/team/computers",
            r#"{"size":"standard","purchaseKey":"buy-dialog-1"}"#,
        ),
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
    assert_no_http_work(&service);
}

#[tokio::test]
async fn listing_answers_with_the_teams_rows_while_the_fleet_is_detached() {
    // A team that never bought a computer, and one with a computer.
    let (with_computer, id) = detached_router_service(false, false).await;
    let without = std::sync::Arc::new(
        crate::domain::service::ComputerService::new(
            crate::domain::fakes::FakeRepo::default(),
            crate::domain::service::test::FakeBilling::default(),
            crate::domain::fakes::FixedClock,
            crate::domain::ports::StaticFleetAttachment(
                crate::domain::models::FleetAttachment::Detached,
            ),
        )
        .with_comp_policy(crate::domain::service::test::availability::RouterCompPolicy(false)),
    );
    for (service, expected) in [(without, vec![]), (with_computer, vec![id.to_string()])] {
        let state = ComputerRouterState {
            service,
            entity_access_service: Arc::new(TeamAccess(TeamRole::Admin)),
            authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
        };
        let router: Router = team_router(state);
        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/team/computers")
                    .header("authorization", "Bearer test-user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 65536)
                .await
                .unwrap(),
        )
        .unwrap();
        let ids: Vec<String> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|computer| computer["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(ids, expected);
    }
}

/// Finishing setup is for the team's owner and admins, like Claude sign-in:
/// an admin who did not buy the computer may, and its buyer may not once only
/// a member.
#[tokio::test]
async fn finishing_setup_follows_the_team_admin_role_not_the_buyer() {
    for (role, buyer, expected) in [
        (
            TeamRole::Admin,
            "macro|someone-else@example.com",
            StatusCode::OK,
        ),
        // The admin-only extractor refuses as every admin route does.
        (
            TeamRole::Member,
            "macro|admin@example.com",
            StatusCode::UNAUTHORIZED,
        ),
    ] {
        let repo = crate::domain::fakes::FakeRepo {
            sold_units: 9,
            ..crate::domain::fakes::FakeRepo::default()
        };
        let id = crate::domain::ids::ComputerId::new_from_uuid(Uuid::now_v7());
        let mut computer = crate::domain::service::test::computer(
            id,
            crate::domain::lifecycle::Phase::Running,
            crate::domain::lifecycle::Billing::Active {
                subscription_item: crate::domain::service::test::item("si_1"),
            },
        );
        if let Some(owner) = computer.owner.as_mut() {
            owner.created_by =
                macro_user_id::user_id::MacroUserIdStr::try_from(buyer.to_owned()).unwrap();
        }
        repo.computers.lock().unwrap().insert(id, computer);
        let service = Arc::new(
            ComputerService::new(
                repo,
                crate::domain::service::test::FakeBilling::default(),
                crate::domain::fakes::FixedClock,
                crate::domain::ports::StaticFleetAttachment(
                    crate::domain::models::FleetAttachment::Attached,
                ),
            )
            .with_comp_policy(crate::domain::service::test::availability::RouterCompPolicy(false)),
        );
        let router: Router = team_router(ComputerRouterState {
            service: service.clone(),
            entity_access_service: Arc::new(TeamAccess(role)),
            authorization_state: MacroAuthorizationState::new(Arc::new(Authorization)),
        });
        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/team/computers/{id}/setup-complete"))
                    .header("authorization", "Bearer test-user")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{role:?}");
    }
}
