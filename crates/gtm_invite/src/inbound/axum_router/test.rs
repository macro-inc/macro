use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    Extension,
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use crate::domain::models::{
    CreateInviteLink, GtmInviteConfig, GtmInviteError, InviteLink, InviteRedemption, InviteToken,
};
use crate::domain::ports::GtmInviteService;
use crate::inbound::axum_router::dto::{
    GtmInviteLink, GtmInviteLinkList, GtmInviteLinkStatus, GtmInviteOffer, GtmInviteOfferStatus,
    PublicGtmInviteLink,
};
use crate::inbound::axum_router::{GtmInviteRouterState, gtm_invite_router};

const STAFF_JWT: &str = "staff";
const OUTSIDER_JWT: &str = "outsider";
const STAFF_USER_ID: &str = "macro|valentina@macro.com";
const OUTSIDER_USER_ID: &str = "macro|ada@startup.io";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            STAFF_JWT => Ok(test_user_context(STAFF_USER_ID)),
            OUTSIDER_JWT => Ok(test_user_context(OUTSIDER_USER_ID)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn test_user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        permissions: None,
        organization_id: None,
    }
}

fn config() -> GtmInviteConfig {
    GtmInviteConfig {
        promo_code: "1MF".parse().unwrap(),
        link_ttl: Duration::hours(48),
        free_months: 1,
    }
}

fn sample_link() -> InviteLink {
    let now = Utc::now();
    InviteLink {
        id: Uuid::now_v7(),
        token: InviteToken::generate(),
        first_name: "Ada".into(),
        recipient_email: Some("ada@startup.io".into()),
        note: None,
        promo_code: "1MF".parse().unwrap(),
        created_by: MacroUserIdStr::try_from_email("valentina@macro.com").unwrap(),
        created_at: now,
        expires_at: now + Duration::hours(48),
        revoked_at: None,
        open_count: 3,
        first_opened_at: Some(now),
        redemption: None,
    }
}

fn redeemed_link() -> InviteLink {
    InviteLink {
        redemption: Some(InviteRedemption {
            user_id: MacroUserIdStr::try_from_email("ada@startup.io").unwrap(),
            redeemed_at: Utc::now(),
            conversion: None,
        }),
        ..sample_link()
    }
}

struct FakeGtmInviteService {
    config: GtmInviteConfig,
    resolve: Result<InviteLink, GtmInviteError>,
    offer: Option<InviteLink>,
}

impl FakeGtmInviteService {
    fn new() -> Self {
        Self {
            config: config(),
            resolve: Ok(sample_link()),
            offer: None,
        }
    }

    fn clone_result(
        result: &Result<InviteLink, GtmInviteError>,
    ) -> Result<InviteLink, GtmInviteError> {
        match result {
            Ok(link) => Ok(link.clone()),
            Err(GtmInviteError::NotFound) => Err(GtmInviteError::NotFound),
            Err(GtmInviteError::Expired) => Err(GtmInviteError::Expired),
            Err(GtmInviteError::AlreadyRedeemed) => Err(GtmInviteError::AlreadyRedeemed),
            Err(_) => Err(GtmInviteError::Internal(anyhow::anyhow!("fake failure"))),
        }
    }
}

impl GtmInviteService for FakeGtmInviteService {
    fn config(&self) -> &GtmInviteConfig {
        &self.config
    }

    async fn create_link(
        &self,
        _creator: &MacroUserIdStr<'_>,
        request: CreateInviteLink,
    ) -> Result<InviteLink, GtmInviteError> {
        Ok(InviteLink {
            first_name: request.first_name,
            ..sample_link()
        })
    }

    async fn list_links(
        &self,
        _caller: &MacroUserIdStr<'_>,
        _only_mine: bool,
    ) -> Result<Vec<InviteLink>, GtmInviteError> {
        Ok(vec![sample_link(), redeemed_link()])
    }

    async fn revoke_link(
        &self,
        _caller: &MacroUserIdStr<'_>,
        _id: Uuid,
    ) -> Result<InviteLink, GtmInviteError> {
        Ok(InviteLink {
            revoked_at: Some(Utc::now()),
            ..sample_link()
        })
    }

    async fn resolve_link(&self, _token: &InviteToken) -> Result<InviteLink, GtmInviteError> {
        Self::clone_result(&self.resolve)
    }

    async fn redeem_link(
        &self,
        _token: &InviteToken,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<InviteLink, GtmInviteError> {
        Self::clone_result(&self.resolve).map(|_| redeemed_link())
    }

    async fn active_offer_for_user(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Option<InviteLink>, GtmInviteError> {
        Ok(self.offer.clone())
    }

    async fn mark_converted(
        &self,
        _user: &MacroUserIdStr<'_>,
        _stripe_subscription_id: &str,
    ) -> Result<bool, GtmInviteError> {
        Ok(true)
    }
}

#[derive(Clone)]
struct MockRateLimitPort {
    should_exceed: bool,
}

impl rate_limit::RateLimitPort for MockRateLimitPort {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            Ok(Err(RateLimitExceeded {
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }))
        } else {
            Ok(Ok(RateLimitOk::new_testing_value(0, key, config)))
        }
    }

    async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
        Ok(())
    }
}

fn rate_limiter(should_exceed: bool) -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort { should_exceed },
    }
}

fn build_router(service: FakeGtmInviteService, rate_limit_exceeded: bool) -> axum::Router {
    let state = GtmInviteRouterState {
        service: Arc::new(service),
        rate_limiter: rate_limiter(rate_limit_exceeded),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    };
    gtm_invite_router(state).layer(Extension(ConnectInfo(SocketAddr::from((
        [127, 0, 0, 1],
        0,
    )))))
}

fn authed(request: axum::http::request::Builder, jwt: &str) -> axum::http::request::Builder {
    request.header(header::AUTHORIZATION, format!("Bearer {jwt}"))
}

fn json_body(value: serde_json::Value) -> Body {
    Body::from(value.to_string())
}

async fn read_json<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn staff_can_create_links() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(Request::post("/links"), STAFF_JWT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "firstName": "Grace" })))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let link: GtmInviteLink = read_json(response).await;
    assert_eq!(link.first_name, "Grace");
    assert_eq!(link.status, GtmInviteLinkStatus::Active);
    assert_eq!(link.promo_code, "1MF");
    assert_eq!(link.free_months, 1);
    assert_eq!(link.created_by, STAFF_USER_ID);
}

#[tokio::test]
async fn outsiders_cannot_create_links() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(Request::post("/links"), OUTSIDER_JWT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "firstName": "Grace" })))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn anonymous_callers_cannot_create_links() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = Request::post("/links")
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "firstName": "Grace" })))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn staff_can_list_links_with_redemption_details() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(Request::get("/links?mine=true"), STAFF_JWT)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let list: GtmInviteLinkList = read_json(response).await;
    assert_eq!(list.links.len(), 2);
    assert_eq!(list.links[1].status, GtmInviteLinkStatus::Redeemed);
    assert_eq!(list.links[1].redeemed_by.as_deref(), Some(OUTSIDER_USER_ID));
}

#[tokio::test]
async fn outsiders_cannot_list_or_revoke_links() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let list = authed(Request::get("/links"), OUTSIDER_JWT)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(list).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );

    let revoke = authed(
        Request::delete(format!("/links/{}", Uuid::now_v7())),
        OUTSIDER_JWT,
    )
    .body(Body::empty())
    .unwrap();
    assert_eq!(
        app.oneshot(revoke).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn staff_can_revoke_links() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(
        Request::delete(format!("/links/{}", Uuid::now_v7())),
        STAFF_JWT,
    )
    .body(Body::empty())
    .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let link: GtmInviteLink = read_json(response).await;
    assert_eq!(link.status, GtmInviteLinkStatus::Revoked);
}

#[tokio::test]
async fn anyone_can_resolve_a_link_and_only_sees_public_fields() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = Request::get(format!("/public/{}", InviteToken::generate()))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let raw: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(raw.get("createdBy").is_none());
    assert!(raw.get("token").is_none());
    let public: PublicGtmInviteLink = serde_json::from_value(raw).unwrap();
    assert_eq!(public.first_name, "Ada");
    assert_eq!(public.status, GtmInviteLinkStatus::Active);
    assert_eq!(public.free_months, 1);
}

#[tokio::test]
async fn resolving_a_malformed_token_is_a_bad_request() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = Request::get("/public/short").body(Body::empty()).unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn resolving_an_unknown_token_is_not_found() {
    let service = FakeGtmInviteService {
        resolve: Err(GtmInviteError::NotFound),
        ..FakeGtmInviteService::new()
    };
    let app = build_router(service, false);
    let request = Request::get(format!("/public/{}", InviteToken::generate()))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn resolving_is_rate_limited_per_ip() {
    let app = build_router(FakeGtmInviteService::new(), true);
    let request = Request::get(format!("/public/{}", InviteToken::generate()))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn the_rate_limit_does_not_cover_authenticated_routes() {
    let app = build_router(FakeGtmInviteService::new(), true);
    let request = authed(Request::get("/offer"), OUTSIDER_JWT)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn signed_in_users_redeem_links_and_receive_the_offer() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(Request::post("/redeem"), OUTSIDER_JWT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(
            serde_json::json!({ "token": InviteToken::generate().as_str() }),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let offer: GtmInviteOffer = read_json(response).await;
    assert_eq!(offer.promo_code, "1MF");
    assert_eq!(offer.first_name, "Ada");
}

#[tokio::test]
async fn redeeming_requires_authentication() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = Request::post("/redeem")
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(
            serde_json::json!({ "token": InviteToken::generate().as_str() }),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn redeeming_an_expired_link_is_gone() {
    let service = FakeGtmInviteService {
        resolve: Err(GtmInviteError::Expired),
        ..FakeGtmInviteService::new()
    };
    let app = build_router(service, false);
    let request = authed(Request::post("/redeem"), OUTSIDER_JWT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(
            serde_json::json!({ "token": InviteToken::generate().as_str() }),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::GONE);
}

#[tokio::test]
async fn redeeming_a_link_someone_else_used_is_a_conflict() {
    let service = FakeGtmInviteService {
        resolve: Err(GtmInviteError::AlreadyRedeemed),
        ..FakeGtmInviteService::new()
    };
    let app = build_router(service, false);
    let request = authed(Request::post("/redeem"), OUTSIDER_JWT)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(
            serde_json::json!({ "token": InviteToken::generate().as_str() }),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn offer_is_null_without_a_redeemed_link() {
    let app = build_router(FakeGtmInviteService::new(), false);
    let request = authed(Request::get("/offer"), OUTSIDER_JWT)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let status: GtmInviteOfferStatus = read_json(response).await;
    assert!(status.offer.is_none());
}

#[tokio::test]
async fn offer_is_returned_for_a_redeemed_link() {
    let service = FakeGtmInviteService {
        offer: Some(redeemed_link()),
        ..FakeGtmInviteService::new()
    };
    let app = build_router(service, false);
    let request = authed(Request::get("/offer"), OUTSIDER_JWT)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let status: GtmInviteOfferStatus = read_json(response).await;
    let offer = status.offer.expect("offer present");
    assert_eq!(offer.promo_code, "1MF");
    assert_eq!(offer.free_months, 1);
}
