use super::*;
use crate::domain::models::SequenceSummary;
use axum::{
    body::{Body, to_bytes},
    http::{Method, Request, header},
};
use macro_authorization::{
    CODE_EXECUTION_HEADER, InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use std::sync::Mutex;
use tower::ServiceExt as _;

#[derive(Clone)]
struct Signed;

impl MacroAuthorizationService for Signed {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: "macro|owner@example.com".to_owned(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_owned(),
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
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Lists nothing and records deletes; no other use case is expected.
#[derive(Default)]
struct Recorder(Mutex<Vec<Uuid>>);

impl SequencesApi for Recorder {
    async fn list(&self, _: &str) -> Result<Vec<SequenceSummary>, SequenceError> {
        Ok(Vec::new())
    }
    async fn create(&self, _: &str, _: NewSequence) -> Result<Sequence, SequenceError> {
        unimplemented!()
    }
    async fn get(
        &self,
        _: &str,
        _: Uuid,
    ) -> Result<(Sequence, Vec<EnrollmentSummary>), SequenceError> {
        unimplemented!()
    }
    async fn update(&self, _: &str, _: Uuid, _: SequencePatch) -> Result<Sequence, SequenceError> {
        unimplemented!()
    }
    async fn delete(&self, _: &str, id: Uuid) -> Result<(), SequenceError> {
        self.0.lock().unwrap().push(id);
        Ok(())
    }
    async fn enroll(
        &self,
        _: &str,
        _: Uuid,
        _: EnrollRequest,
    ) -> Result<Vec<EnrollResult>, SequenceError> {
        unimplemented!()
    }
    async fn act(
        &self,
        _: &str,
        _: Uuid,
        _: EnrollmentAction,
    ) -> Result<EnrollmentSummary, SequenceError> {
        unimplemented!()
    }
    async fn contact_enrollments(
        &self,
        _: &str,
        _: Uuid,
    ) -> Result<Vec<ContactEnrollment>, SequenceError> {
        unimplemented!()
    }
    async fn unsubscribe(&self, _: &str) -> Result<bool, SequenceError> {
        unimplemented!()
    }
}

fn app() -> (Router, Arc<Recorder>) {
    let service = Arc::new(Recorder::default());
    let router = sequences_router(SequencesRouterState::new(
        service.clone(),
        MacroAuthorizationState::new(Arc::new(Signed)),
    ));
    (router, service)
}

async fn send(router: &Router, method: Method, uri: &str, as_program: bool) -> Response {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, "Bearer token")
        .header(header::CONTENT_TYPE, "application/json");
    if as_program {
        request = request.header(CODE_EXECUTION_HEADER, "1");
    }
    router
        .clone()
        .oneshot(request.body(Body::from("{}")).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn an_agents_program_can_read_but_never_change_a_sequence() {
    let (router, service) = app();
    let id = Uuid::from_u128(7);
    for (method, uri) in [
        (Method::POST, "/".to_owned()),
        (Method::PATCH, format!("/{id}")),
        (Method::DELETE, format!("/{id}")),
        (Method::POST, format!("/{id}/enrollments")),
        (Method::PATCH, format!("/enrollments/{id}")),
    ] {
        let response = send(&router, method.clone(), &uri, true).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {uri}");
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "person_required", "{method} {uri}");
    }
    assert!(service.0.lock().unwrap().is_empty());

    let read = send(&router, Method::GET, "/", true).await;
    assert_eq!(read.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_person_changes_a_sequence() {
    let (router, service) = app();
    let id = Uuid::from_u128(7);
    let response = send(&router, Method::DELETE, &format!("/{id}"), false).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(*service.0.lock().unwrap(), vec![id]);
}
