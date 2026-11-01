use super::*;
use crate::domain::{
    models::{
        ContactEnrollment, EnrollResult, EnrollmentAction, EnrollmentDetail, EnrollmentSummary,
        Sequence, SequenceError, SequenceSummary,
    },
    ports::NewSequence,
    service::{EnrollRequest, SequencePatch},
};
use axum::{body::Body, http::Request};
use std::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

/// Records unsubscribes; the token `known` is the only valid one.
#[derive(Default)]
struct Recorder(Mutex<Vec<String>>);

impl SequencesApi for Recorder {
    async fn list(&self, _: &str) -> Result<Vec<SequenceSummary>, SequenceError> {
        unimplemented!()
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
    async fn delete(&self, _: &str, _: Uuid) -> Result<(), SequenceError> {
        unimplemented!()
    }
    async fn enroll(
        &self,
        _: &str,
        _: Uuid,
        _: EnrollRequest,
    ) -> Result<Vec<EnrollResult>, SequenceError> {
        unimplemented!()
    }
    async fn enrollment(&self, _: &str, _: Uuid) -> Result<EnrollmentDetail, SequenceError> {
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
    async fn unsubscribe(&self, token: &str) -> Result<bool, SequenceError> {
        self.0.lock().unwrap().push(token.to_owned());
        Ok(token == "known")
    }
}

async fn request(router: &Router, method: &str, token: &str) -> Response {
    router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/public/sequences/unsubscribe/{token}"))
                .header("content-type", "application/x-www-form-urlencoded")
                .body(Body::from("List-Unsubscribe=One-Click"))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn only_a_post_unsubscribes() {
    let api = Arc::new(Recorder::default());
    let router: Router = unsubscribe_router(api.clone());

    // A link scanner fetching the link changes nothing.
    for method in ["GET", "HEAD"] {
        let response = request(&router, method, "known").await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(response.headers()[header::REFERRER_POLICY], "no-referrer");
    }
    assert!(api.0.lock().unwrap().is_empty());

    // Gmail's one-click POST and the page's button both unsubscribe.
    assert_eq!(
        request(&router, "POST", "known").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&router, "POST", "unknown").await.status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(*api.0.lock().unwrap(), ["known", "unknown"]);
}
