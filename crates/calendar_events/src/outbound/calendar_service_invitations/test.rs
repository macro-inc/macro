use super::*;
use crate::domain::invitations::InvitationRevision;
use crate::inbound::invitation_router::{
    CalendarInvitationRouterState, calendar_invitation_router,
};
use axum::{Json, Router, http::StatusCode, routing::post};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use std::sync::Arc;
use uuid::Uuid;

const VIEWER: &str = "macro|invitation-reader@example.com";
const KEY: &str = "invitation-test-key";

#[derive(Clone)]
struct TestJwt;
impl JwtValidator for TestJwt {
    fn validate(&self, _: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        Ok(ValidatedIdentity {
            user_id: VIEWER.into(),
            fusion_user_id: "test".into(),
            organization_id: None,
            permissions: None,
        })
    }
}

struct Calendar;
impl CalendarInvitationService for Calendar {
    async fn resolve(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> Result<Vec<InvitationResolution>, Report> {
        assert_eq!(
            viewer, VIEWER,
            "the verified viewer crosses the service boundary"
        );
        assert_eq!(
            serde_json::to_value(items).unwrap(),
            serde_json::to_value([identity()]).unwrap(),
            "original occurrence, responding inbox, and independent revision streams survive transport"
        );
        Ok(vec![InvitationResolution::Cancelled])
    }
}

fn identity() -> InvitationIdentity {
    InvitationIdentity {
        id: "message:component".into(),
        uid: "series@google.com".into(),
        preferred_link_id: Uuid::from_u128(7),
        occurrence_key: Some("2026-09-24T17:00:00Z".into()),
        unresolved_instance: false,
        cancelled: false,
        organizer_email: Some("alex@example.com".into()),
        last_modified: Some(
            chrono::DateTime::parse_from_rfc3339("2026-09-22T12:00:00Z")
                .unwrap()
                .into(),
        ),
        sequence: 8,
        related_revisions: vec![InvitationRevision {
            link_id: Uuid::from_u128(8),
            sequence: 9,
            last_modified: None,
            cancelled: false,
        }],
        series_revisions: vec![InvitationRevision {
            link_id: Uuid::from_u128(7),
            sequence: 2,
            last_modified: None,
            cancelled: true,
        }],
    }
}

struct Server {
    url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn serve(router: Router) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/calendar", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, Router::new().nest("/calendar", router))
            .await
            .unwrap();
    });
    Server { url, task }
}

#[tokio::test]
async fn internal_client_and_router_preserve_identity_and_reject_browser_credentials() {
    let auth = MacroAuthorizationServiceImpl::new(
        TestJwt,
        InternalAuthConfig {
            api_key: KEY.into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let server = serve(calendar_invitation_router(
        CalendarInvitationRouterState::new(
            Arc::new(Calendar),
            MacroAuthorizationState::new(Arc::new(auth)),
        ),
    ))
    .await;
    let client = CalendarServiceInvitations::new(format!("{}/", server.url), KEY.into());
    assert!(matches!(
        client.resolve(VIEWER, &[identity()]).await.unwrap()[0],
        InvitationResolution::Cancelled
    ));
    let endpoint = format!("{}/internal/invitations/resolve", server.url);
    let http = reqwest::Client::new();
    // Even a valid user token cannot supply scheduling revisions directly.
    assert_eq!(
        http.post(&endpoint)
            .bearer_auth("valid")
            .json(&[identity()])
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        http.post(&endpoint)
            .header("x-internal-auth-key", KEY)
            .json(&[identity()])
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert!(
        CalendarServiceInvitations::new(server.url.clone(), "wrong".into())
            .resolve(VIEWER, &[identity()])
            .await
            .is_err()
    );
    let oversized = vec![identity(); MAX_INVITATION_BATCH + 1];
    assert_eq!(
        http.post(&endpoint)
            .header("x-internal-auth-key", KEY)
            .header("x-internal-macro-user-id", VIEWER)
            .json(&oversized)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert!(client.resolve(VIEWER, &oversized).await.is_err());
}

#[tokio::test]
async fn missing_failed_or_incomplete_calendar_responses_are_not_successful_lookups() {
    for router in [
        Router::new(),
        Router::new().route(
            "/internal/invitations/resolve",
            post(|| async { StatusCode::SERVICE_UNAVAILABLE }),
        ),
        Router::new().route(
            "/internal/invitations/resolve",
            post(|| async { Json(Vec::<InvitationResolution>::new()) }),
        ),
    ] {
        let server = serve(router).await;
        let client = CalendarServiceInvitations::new(server.url.clone(), KEY.into());
        assert!(client.resolve(VIEWER, &[identity()]).await.is_err());
    }
}
