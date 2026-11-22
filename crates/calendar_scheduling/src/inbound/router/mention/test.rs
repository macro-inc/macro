use super::*;
use crate::domain::{
    models::{BookingRecord, BookingStatus},
    ports::Repository,
    service::{
        Service,
        test::{Calendar, Members, Memory, TestService, profile, request},
    },
};
use crate::inbound::router::{RouterState, router};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, header},
};
use chrono::Duration;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

const USER: &str = "macro|host@example.com";

#[derive(Clone)]
struct Host;
impl MacroAuthorizationService for Host {
    async fn authorize(&self, token: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if token != "host" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER.to_owned(),
            fusion_user_id: "host".into(),
            ..Default::default()
        })
    }
    async fn authorize_identity(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(token)
            .await
            .map(ValidatedCredential::session)
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

async fn setup(pending: bool) -> (Router, Arc<TestService>, BookingRecord) {
    let repository = Arc::new(Memory::default());
    let service = Arc::new(Service::new(
        repository.clone(),
        Arc::new(Calendar::default()),
        Members,
    ));
    let mut profile = profile(None);
    profile.id = TestService::profile_id(USER, None);
    profile.event_types[0].hosts = vec![USER.to_owned()];
    let profile = service.save(USER, None, profile).await.unwrap();
    let mut booking = service
        .book(profile.id, profile.event_types[0].id, request())
        .await
        .unwrap();
    if pending {
        // Legacy approval-required bookings still exist; modern links auto-confirm.
        booking.booking.status = BookingStatus::Pending;
        booking.calendar_event_id = None;
        booking.event.requires_confirmation = true;
        booking = repository
            .update_booking(booking, BookingStatus::Confirmed)
            .await
            .unwrap();
    }
    let app = Router::new().nest(
        "/scheduling",
        router(RouterState::new(
            service.clone(),
            MacroAuthorizationState::new(Arc::new(Host)),
        )),
    );
    (app, service, booking)
}

fn mention() -> agent_correlation::context::Attribution {
    agent_correlation::context::Attribution {
        channel_mention_id: Some(Uuid::from_u128(1)),
        ..Default::default()
    }
}

async fn call(app: &Router, method: &str, path: &str, body: Value, host: bool) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if host {
        request = request.header(header::AUTHORIZATION, "Bearer host");
    }
    app.clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_mention_cannot_cancel_a_host_booking() {
    let (app, service, booking) = setup(false).await;
    for suffix in ["change", "cancel"] {
        let response = agent_correlation::context::scope_attribution(
            mention(),
            call(
                &app,
                "POST",
                &format!("/scheduling/bookings/{}/{suffix}", booking.booking.id),
                json!({"action": "cancel"}),
                true,
            ),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(
        service
            .manage(USER, booking.booking.id)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Confirmed
    );
}

#[tokio::test]
async fn a_mention_cannot_reschedule_a_host_booking() {
    let (app, service, booking) = setup(false).await;
    let response = agent_correlation::context::scope_attribution(mention(), call(
        &app, "POST", &format!("/scheduling/bookings/{}/change", booking.booking.id),
        json!({"action": "reschedule", "startsAt": booking.booking.starts_at + Duration::hours(1)}), true,
    )).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        service
            .manage(USER, booking.booking.id)
            .await
            .unwrap()
            .booking
            .starts_at,
        booking.booking.starts_at
    );
}

#[tokio::test]
async fn a_mention_cannot_approve_a_host_booking() {
    let (app, service, booking) = setup(true).await;
    for suffix in ["change", "approve"] {
        let response = agent_correlation::context::scope_attribution(
            mention(),
            call(
                &app,
                "POST",
                &format!("/scheduling/bookings/{}/{suffix}", booking.booking.id),
                json!({"action": "approve"}),
                true,
            ),
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(
        service
            .manage(USER, booking.booking.id)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Pending
    );
}

#[tokio::test]
async fn a_mention_cannot_obtain_a_booking_manage_token() {
    let (app, _, booking) = setup(false).await;
    let path = format!("/scheduling/bookings/{}/manage", booking.booking.id);
    let response = agent_correlation::context::scope_attribution(
        mention(),
        call(&app, "GET", &path, Value::Null, true),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(
        !String::from_utf8(body.to_vec())
            .unwrap()
            .contains(&booking.token.to_string())
    );
    let response = call(&app, "GET", &path, Value::Null, true).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["token"], booking.token.to_string());
}

#[tokio::test]
async fn a_mention_can_still_read_host_bookings_and_insights() {
    let (app, _, booking) = setup(false).await;
    agent_correlation::context::scope_attribution(mention(), async {
        for path in [
            "/scheduling/settings",
            "/scheduling/bookings",
            "/scheduling/links",
        ] {
            assert_eq!(
                call(&app, "GET", path, Value::Null, true).await.status(),
                StatusCode::OK
            );
        }
        let date = booking.booking.starts_at.date_naive();
        assert_eq!(
            call(
                &app,
                "POST",
                "/scheduling/insights",
                json!({"from":date,"to":date,"timeZone":"UTC"}),
                true
            )
            .await
            .status(),
            StatusCode::OK
        );
    })
    .await;
}

#[tokio::test]
async fn a_booker_can_still_reschedule_and_cancel_with_their_token() {
    let (app, service, booking) = setup(false).await;
    let start = booking.booking.starts_at + Duration::hours(1);
    // Public booker routes retain their capability authorization even when
    // another credential on a request carries a mention claim.
    agent_correlation::context::scope_attribution(mention(), async {
        let response = call(
            &app,
            "POST",
            &format!(
                "/scheduling/public/bookings/{}/reschedule",
                booking.booking.id
            ),
            json!({"token":booking.token,"startsAt":start}),
            false,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            service
                .receipt(booking.booking.id, booking.token)
                .await
                .unwrap()
                .booking
                .starts_at,
            start
        );
        let response = call(
            &app,
            "POST",
            &format!("/scheduling/public/bookings/{}/cancel", booking.booking.id),
            json!({"token":booking.token}),
            false,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
    })
    .await;
    assert_eq!(
        service
            .receipt(booking.booking.id, booking.token)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Cancelled
    );
}
