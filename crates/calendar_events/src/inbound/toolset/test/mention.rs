use super::*;
use crate::domain::replacement::{CalendarReplacementService, CalendarReplacementView};
use crate::domain::{
    copies::{CopyChange, CopyRefusal},
    models::EventDetails,
    ports::{CalendarCopyConfirmation, CalendarEventDetailsReader},
};
use crate::inbound::mutation_router::{CalendarMutationRouterState, calendar_mutation_router};
use crate::inbound::replacement_router::{
    CalendarReplacementRouterState, calendar_replacement_router,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
};
use rootcause::Report;
use tower::ServiceExt;

#[derive(Clone)]
struct NoCredentials;
impl JwtValidator for NoCredentials {
    fn validate_credential(
        &self,
        _: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        panic!("no bearer credential is used in these tests")
    }
}

impl CalendarCopyConfirmation for MockMutations {
    async fn confirm_copy(
        &self,
        _: &str,
        _: Uuid,
        _: Option<&str>,
        _: CopyChange,
    ) -> Result<Option<CopyRefusal>, CalendarMutationError> {
        panic!("mention programs are refused before choosing a copy")
    }
}
impl CalendarEventDetailsReader for MockMutations {
    async fn details_for_update(
        &self,
        _: &str,
        _: Uuid,
        _: Option<Uuid>,
        _: &CalendarUpdateScope,
    ) -> Result<EventDetails, CalendarMutationError> {
        panic!("mention programs are refused before loading event details")
    }
}

fn app(mutations: Arc<MockMutations>) -> axum::Router {
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        NoCredentials,
        InternalAuthConfig {
            api_key: "test-key".into(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    calendar_mutation_router(CalendarMutationRouterState::new(
        mutations,
        Arc::new(MockMeetingLinks::default()),
        authorization.clone(),
    ))
    .merge(calendar_replacement_router(
        CalendarReplacementRouterState::new(Arc::new(NoReplacements), authorization),
    ))
}

fn mention() -> agent_correlation::context::Attribution {
    agent_correlation::context::Attribution {
        channel_mention_id: Some(Uuid::from_u128(1)),
        ..Default::default()
    }
}

async fn refused(method: &str, path: &str, body: serde_json::Value) {
    let mutations = Arc::new(MockMutations::default());
    let app = app(mutations.clone());
    let request = || {
        Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };
    let response =
        agent_correlation::context::scope_attribution(mention(), app.clone().oneshot(request()))
            .await
            .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(mutations.updated.lock().unwrap().is_empty());
    assert!(mutations.deleted.lock().unwrap().is_empty());
    assert!(mutations.answered.lock().unwrap().is_empty());
    // Without the signed mention, the route reaches its ordinary authentication.
    assert_eq!(
        app.oneshot(request()).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_mention_cannot_invite_guests() {
    refused(
        "POST",
        "/events/00000000-0000-0000-0000-000000000007/guests",
        serde_json::json!({"guests": [{"email": "guest@example.com"}]}),
    )
    .await;
}

#[tokio::test]
async fn a_mention_cannot_replace_attendees() {
    refused(
        "PATCH",
        "/events/00000000-0000-0000-0000-000000000007",
        serde_json::json!({"attendees": [{"email": "guest@example.com"}]}),
    )
    .await;
}

#[tokio::test]
async fn a_mention_cannot_email_an_update_to_existing_guests() {
    refused(
        "PATCH",
        "/events/00000000-0000-0000-0000-000000000007",
        serde_json::json!({"description": "A changed description"}),
    )
    .await;
}

#[tokio::test]
async fn a_mention_cannot_send_a_cancellation() {
    refused(
        "DELETE",
        "/events/00000000-0000-0000-0000-000000000007",
        serde_json::Value::Null,
    )
    .await;
}

#[tokio::test]
async fn a_mention_cannot_send_an_rsvp() {
    refused(
        "PUT",
        "/events/00000000-0000-0000-0000-000000000007/rsvp",
        serde_json::json!({"response": "accepted"}),
    )
    .await;
}

#[tokio::test]
async fn a_mention_cannot_invite_through_a_join_request() {
    refused(
        "PUT",
        "/join-requests/00000000-0000-0000-0000-000000000007",
        serde_json::json!({"decision": "accept"}),
    )
    .await;
}

#[tokio::test]
async fn a_guestless_confirmed_create_cannot_be_followed_by_invite_guests() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let mut args = create_tool_args();
    args["userConfirmation"] = serde_json::json!("yes, create it without guests");
    agent_correlation::context::scope_attribution(mention(), async {
        let event = calendar_toolset()
            .try_tool_call(
                context.0,
                request_context(),
                "CreateConfirmedCalendarEvent",
                &args,
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(mutations.created.lock().unwrap().len(), 1);
        assert!(mutations.created.lock().unwrap()[0].2.attendees.is_empty());
        let path = format!("/events/{}/guests", event["eventId"].as_str().unwrap());
        let response = app(mutations)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"guests": [{"email": "guest@example.com"}]}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    })
    .await;
}

struct NoReplacements;
impl CalendarReplacementService for NoReplacements {
    async fn recover_replacements(&self) -> Result<usize, Report> {
        panic!("not used")
    }
    async fn prepare_replacement(
        &self,
        _: &str,
        _: Uuid,
        _: Option<Uuid>,
        _: Option<String>,
        _: bool,
        _: CalendarEventPatch,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        panic!("not used")
    }
    async fn confirm_replacement(
        &self,
        _: &str,
        _: Uuid,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        panic!("mention programs cannot send replacements")
    }
    async fn replacement_status(
        &self,
        _: &str,
        _: Uuid,
    ) -> Result<CalendarReplacementView, CalendarMutationError> {
        panic!("not used")
    }
    async fn discard_replacement(&self, _: &str, _: Uuid) -> Result<(), CalendarMutationError> {
        panic!("not used")
    }
    async fn event_provider_url(
        &self,
        _: &str,
        _: Uuid,
        _: Option<Uuid>,
        _: Option<String>,
    ) -> Result<Option<String>, CalendarMutationError> {
        panic!("not used")
    }
}

#[tokio::test]
async fn a_mention_cannot_send_a_replacement_invitation() {
    refused(
        "POST",
        "/replacements/00000000-0000-0000-0000-000000000007/confirm",
        serde_json::Value::Null,
    )
    .await;
}

#[tokio::test]
async fn a_mention_can_still_read_calendars_and_add_a_snapshot_copy() {
    let mutations = Arc::new(MockMutations::default());
    let app = app(mutations.clone());
    agent_correlation::context::scope_attribution(mention(), async {
        for (method, path, expected) in [
            ("GET", "/calendars", StatusCode::OK),
            (
                "POST",
                "/events/00000000-0000-0000-0000-000000000007/copy",
                StatusCode::CREATED,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("content-type", "application/json")
                        .header("x-internal-auth-key", "test-key")
                        .header("x-internal-macro-user-id", "macro|test@example.com")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    })
    .await;
    assert_eq!(mutations.copied.lock().unwrap().len(), 1);
}
