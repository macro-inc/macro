use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ai_billing::AiAdmissionError;
use anyhow::Result;
use axum::Router;
use axum::http::StatusCode;
use chrono::Utc;
use macro_authorization::MacroAuthorizationState;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde_json::{Value, json};

use super::{RoutineDraftJobRouterState, routine_draft_job_router};
use crate::domain::drafts::jobs::{DraftAsked, DraftJob, DraftJobError, DraftJobState, DraftKind};
use crate::domain::drafts::progress::DraftJobProgress;
use crate::domain::drafts::{Draft, DraftContext, DraftRequest, InvalidDraft};
use crate::domain::ports::{RoutineDraftJobService, RoutineDraftService};
use crate::inbound::axum_router::test::{FakeAuth, request};
use crate::inbound::draft_router::{RoutineDraftRouterState, routine_draft_router};

/// Keeps each started job, drafting, under its owner, and the job each
/// owner's client id started.
#[derive(Default)]
struct Jobs(Mutex<HashMap<Uuid, (MacroUserIdStr<'static>, DraftJob)>>);

impl RoutineDraftJobService for Jobs {
    async fn start(
        &self,
        owner: MacroUserIdStr<'static>,
        client_id: Uuid,
        request: DraftRequest,
        _: DraftContext,
        _: Option<String>,
    ) -> Result<DraftJob> {
        if let DraftRequest::Routine { description } = &request {
            match description.as_str() {
                "busy" => return Err(AiAdmissionError::Unavailable.into()),
                "again" => return Err(DraftJobError::TooMany.into()),
                text if text.trim().is_empty() => {
                    return Err(InvalidDraft("describe it".into()).into());
                }
                _ => {}
            }
        }
        // The fake's job id is its client id: a start sent again finds it.
        if let Some((by, job)) = self.0.lock().unwrap().get(&client_id)
            && *by == owner
        {
            return Ok(job.clone());
        }
        let job = DraftJob {
            id: client_id,
            request: DraftAsked {
                kind: DraftKind::Routine,
                description: match &request {
                    DraftRequest::Routine { description } => description.clone(),
                    _ => String::new(),
                },
            },
            progress: DraftJobProgress::default(),
            created_at: Utc::now(),
            state: DraftJobState::Drafting,
        };
        self.0
            .lock()
            .unwrap()
            .insert(job.id, (owner, job.clone()));
        Ok(job)
    }

    async fn jobs(&self, owner: MacroUserIdStr<'static>) -> Result<Vec<DraftJob>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .values()
            .filter(|(by, _)| *by == owner)
            .map(|(_, job)| job.clone())
            .collect())
    }

    async fn job(&self, owner: MacroUserIdStr<'static>, id: Uuid) -> Result<DraftJob> {
        match self.0.lock().unwrap().get(&id) {
            Some((by, job)) if *by == owner => Ok(job.clone()),
            _ => Err(DraftJobError::NotFound.into()),
        }
    }

    async fn discard(&self, owner: MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        let mut jobs = self.0.lock().unwrap();
        match jobs.get(&id) {
            Some((by, _)) if *by == owner => {
                jobs.remove(&id);
                Ok(())
            }
            _ => Err(DraftJobError::NotFound.into()),
        }
    }
}

/// The blocking route's service: every draft fails.
struct Drafts;

impl RoutineDraftService for Drafts {
    async fn draft(
        &self,
        _: MacroUserIdStr<'static>,
        _: DraftRequest,
        _: DraftContext,
    ) -> Result<Draft> {
        Ok(Draft::Failed {
            message: "no".into(),
            created: Vec::new(),
        })
    }
}

fn router() -> Router {
    routine_draft_job_router(RoutineDraftJobRouterState {
        service: Arc::new(Jobs::default()),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

/// The blocking route's body.
fn body(description: &str) -> Value {
    json!({
        "draft": { "type": "routine", "description": description },
        "context": { "timezone": "UTC", "agentModel": "anthropic/claude-sonnet-5-5" },
    })
}

/// A start's body, as the start the client gave `client_id`.
fn start_as(client_id: Uuid, description: &str) -> Value {
    let mut body = body(description);
    body["clientId"] = json!(client_id);
    body
}

/// A new start's body.
fn start(description: &str) -> Value {
    start_as(macro_uuid::generate_uuid_v7(), description)
}

const JOBS: &str = "/scheduled-actions/draft-jobs";

#[tokio::test]
async fn starts_lists_reads_and_discards_the_callers_drafts() {
    let app = router();

    let client_id = macro_uuid::generate_uuid_v7();
    let (status, job) = request(
        &app,
        "POST",
        JOBS,
        "owner",
        start_as(client_id, "label invoices"),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(job["state"], "drafting");
    assert_eq!(job["request"], json!({ "kind": "routine", "description": "label invoices" }));
    assert_eq!(job["progress"], json!({ "stage": "started" }));
    let one = format!("{JOBS}/{}", job["id"].as_str().unwrap());
    // Sent again, the start answers with the same job.
    assert_eq!(
        request(
            &app,
            "POST",
            JOBS,
            "owner",
            start_as(client_id, "label invoices"),
        )
        .await,
        (StatusCode::ACCEPTED, job.clone())
    );

    let (status, listed) = request(&app, "GET", JOBS, "owner", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed, json!([job]));
    let (status, read) = request(&app, "GET", &one, "owner", Value::Null).await;
    assert_eq!((status, &read), (StatusCode::OK, &job));

    // Someone else's is not there for them.
    assert_eq!(
        request(&app, "GET", JOBS, "other", Value::Null).await,
        (StatusCode::OK, json!([]))
    );
    assert_eq!(
        request(&app, "GET", &one, "other", Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, "DELETE", &one, "other", Value::Null).await.0,
        StatusCode::NOT_FOUND
    );

    assert_eq!(
        request(&app, "DELETE", &one, "owner", Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(&app, "GET", &one, "owner", Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(&app, "DELETE", &one, "owner", Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn needs_a_signed_in_user() {
    let app = router();
    let one = format!("{JOBS}/{}", Uuid::nil());

    for (method, path, body) in [
        ("POST", JOBS, start("label invoices")),
        ("GET", JOBS, Value::Null),
        ("GET", &one, Value::Null),
        ("DELETE", &one, Value::Null),
    ] {
        assert_eq!(
            request(&app, method, path, "invalid", body).await.0,
            StatusCode::UNAUTHORIZED,
            "{method} {path}"
        );
    }
}

/// Starting answers what the blocking route answers for what it can't start.
#[tokio::test]
async fn refuses_what_it_cannot_start_like_the_blocking_route() {
    let app = router();

    for (body, status) in [
        (start(" "), StatusCode::BAD_REQUEST),
        (json!({ "draft": { "type": "poem" } }), StatusCode::BAD_REQUEST),
        // A start needs the client's id for it.
        (body("label invoices"), StatusCode::BAD_REQUEST),
        (start("busy"), StatusCode::SERVICE_UNAVAILABLE),
        (start("again"), StatusCode::CONFLICT),
    ] {
        assert_eq!(
            request(&app, "POST", JOBS, "owner", body.clone()).await.0,
            status,
            "{body}"
        );
    }
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{JOBS}/not-an-id"),
            "owner",
            Value::Null
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

/// Merged with the other routine routes, as the harness serves them, each
/// path reaches its own handler.
#[tokio::test]
async fn its_paths_live_beside_the_routine_routes() {
    let app = crate::inbound::axum_router::test::router(false)
        .merge(routine_draft_router(RoutineDraftRouterState {
            service: Arc::new(Drafts),
            authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
        }))
        .merge(router());

    let (status, job) = request(&app, "POST", JOBS, "owner", start("label invoices")).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let one = format!("{JOBS}/{}", job["id"].as_str().unwrap());
    assert_eq!(request(&app, "GET", &one, "owner", Value::Null).await.1, job);
    assert_eq!(
        request(&app, "GET", JOBS, "owner", Value::Null).await.1,
        json!([job])
    );
    // The blocking route still answers itself.
    let (status, draft) = request(
        &app,
        "POST",
        "/scheduled-actions/drafts",
        "owner",
        body("label invoices"),
    )
    .await;
    assert_eq!((status, &draft["outcome"]), (StatusCode::OK, &json!("failed")));
    // And a routine id is still a routine's.
    let (status, _) = request(
        &app,
        "GET",
        &format!("/scheduled-actions/{}", Uuid::nil()),
        "owner",
        Value::Null,
    )
    .await;
    assert_ne!(status, StatusCode::ACCEPTED);
    assert_ne!(status, StatusCode::METHOD_NOT_ALLOWED);
}
