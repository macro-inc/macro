//! What `email_focus_worker` asks outside Macro's own database, stood in
//! for: the model that answers the Focus questions about a thread, and the
//! agent harness route that reads the day a thread is due.
//!
//! The questions, their order and the thread ids are the product's, so a
//! scenario does not script answers by them. It says which mail belongs in
//! Focus by a piece of text that mail holds (its subject, say), and the
//! model stand-in answers "yes" to the first question, whether the owner
//! would want the thread in Focus, exactly for the requests that hold such
//! text. Every other question is answered "no", so nothing but that answer
//! decides.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header::AUTHORIZATION};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use chrono::NaiveDate;
use rootcause::prelude::*;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// The path prefix of the model API's stand-in, and its name in the
/// scenario's record.
pub(crate) const MODEL_API: &str = "typesafe";
/// The path prefix of the agent harness stand-in, and its name in the
/// scenario's record.
pub(crate) const AGENT_HARNESS: &str = "agent-harness";
/// Where the worker asks the model, under the API's base.
const EVALUATE_ROUTE: &str = "/v1/systemone";
/// Where the worker asks the harness for a due date, under its base.
const DUE_DATE_ROUTE: &str = "/universal_input/thread-due-date";
/// The question the worker asks first: would the owner want this thread
/// in Focus (`FocusQuestion::ALL` in `crates/email`).
const FOCUS_QUESTION: &str = "q0";
/// The key the worker is given for the model API, which the stand-in asks
/// for as the API does.
pub(crate) const MODEL_API_KEY: &str = "email-e2e";
/// The headers a service names itself and the user with to the harness.
const INTERNAL_KEY_HEADER: &str = "x-internal-auth-key";
const INTERNAL_USER_HEADER: &str = "x-internal-macro-user-id";
/// The model's "yes" and "no", as probabilities.
const YES: f64 = 0.9;
const NO: f64 = 0.0;

#[derive(Default)]
struct Answers {
    /// Text that marks mail as belonging in Focus.
    focus: Vec<String>,
    /// Text that marks mail as due, with the day.
    due: Vec<(String, NaiveDate)>,
    /// The input of every question the model was asked, oldest first. Kept
    /// in memory for [`FocusClassifier::times_asked_about`] only: it is
    /// mail, and never reaches the scenario's record.
    asked: Vec<String>,
    /// The stand-in and route of every request, oldest first.
    calls: Vec<(&'static str, &'static str)>,
}

/// The model and the due date reader the Focus worker asks, as a scenario
/// sets them ([`Stack::focus_classifier`](crate::Stack::focus_classifier)).
/// Until told otherwise the model finds no mail worth Focus and no thread
/// has a due date.
#[derive(Clone, Default)]
pub struct FocusClassifier {
    answers: Arc<Mutex<Answers>>,
}

impl FocusClassifier {
    fn answers(&self) -> MutexGuard<'_, Answers> {
        self.answers.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// From now on the model says a thread belongs in Focus when what the
    /// worker shows it (the thread's subject, senders and latest messages)
    /// holds `text`. Give plain words: the text is looked for in the
    /// request's JSON.
    pub fn put_in_focus_when_mail_contains(&self, text: &str) {
        self.answers().focus.push(text.to_owned());
    }

    /// From now on the agent harness reads `day` as the day a thread is due
    /// when the thread's subject or messages hold `text`.
    pub fn due_on_when_mail_contains(&self, text: &str, day: NaiveDate) {
        self.answers().due.push((text.to_owned(), day));
    }

    /// How often the worker asked the model about mail that holds `text`:
    /// zero for mail it never sent to the model.
    pub fn times_asked_about(&self, text: &str) -> usize {
        self.answers()
            .asked
            .iter()
            .filter(|input| input.contains(text))
            .count()
    }

    /// The stand-in and route of every request so far, oldest first.
    pub(crate) fn calls(&self) -> Vec<(&'static str, &'static str)> {
        self.answers().calls.clone()
    }
}

/// The running stand-ins.
pub(crate) struct FocusStandIns {
    classifier: FocusClassifier,
    address: SocketAddr,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

impl FocusStandIns {
    /// Starts the server both stand-ins answer on.
    pub(crate) async fn start() -> Result<Self, Report> {
        let classifier = FocusClassifier::default();
        let listener = crate::host::local_listener()
            .await
            .context("could not bind the Focus stand-ins")?;
        let address = listener.local_addr()?;
        let app = Router::new()
            .route(&format!("/{MODEL_API}{EVALUATE_ROUTE}"), post(evaluate))
            .route(&format!("/{AGENT_HARNESS}{DUE_DATE_ROUTE}"), post(due_date))
            .with_state(classifier.clone());

        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        let stopped = cancel.clone();
        tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "the Focus stand-ins stopped");
            }
        });
        Ok(Self {
            classifier,
            address,
            cancel,
            tracker,
        })
    }

    /// What the scenario sets the answers through.
    pub(crate) fn classifier(&self) -> &FocusClassifier {
        &self.classifier
    }

    /// The model API's base URL.
    pub(crate) fn model_url(&self) -> String {
        format!("http://{}/{MODEL_API}", self.address)
    }

    /// The agent harness's base URL.
    pub(crate) fn harness_url(&self) -> String {
        format!("http://{}/{AGENT_HARNESS}", self.address)
    }

    /// Stops the server.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

/// The model: every question asked gets an answer, "yes" only to the Focus
/// question about mail the scenario marked. The wire shape is the one
/// `jev::outbound::SystemOneJev` speaks with TypeSafe.
async fn evaluate(
    State(classifier): State<FocusClassifier>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    let bearer = format!("Bearer {MODEL_API_KEY}");
    if header(&headers, AUTHORIZATION.as_str()) != bearer {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let input = request["state"].to_string();
    let mut answers = classifier.answers();
    let in_focus = answers.focus.iter().any(|text| input.contains(text));
    answers.asked.push(input);
    answers.calls.push((MODEL_API, EVALUATE_ROUTE));
    let answered: serde_json::Map<String, Value> = request["questions"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, _)| {
            let yes = in_focus && id == FOCUS_QUESTION;
            (
                id.clone(),
                json!({ "type": "noul", "noul": if yes { YES } else { NO } }),
            )
        })
        .collect();
    Json(json!({
        "model": request["model"],
        "answers": answered,
        "usage": { "input_tokens": 1, "output_tokens": 1 },
    }))
    .into_response()
}

/// The agent harness's due date route: the day the scenario set for mail
/// the thread holds, or none.
async fn due_date(
    State(classifier): State<FocusClassifier>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    // The harness serves only a service that names itself and the user.
    if header(&headers, INTERNAL_KEY_HEADER).is_empty()
        || header(&headers, INTERNAL_USER_HEADER).is_empty()
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let thread = json!([request["subject"], request["messages"]]).to_string();
    let mut answers = classifier.answers();
    answers.calls.push((AGENT_HARNESS, DUE_DATE_ROUTE));
    let due_on = answers
        .due
        .iter()
        .find(|(text, _)| thread.contains(text))
        .map(|(_, day)| day.format("%Y-%m-%d").to_string());
    Json(json!({ "due_on": due_on })).into_response()
}

/// A header's value, empty when it is missing or not text.
fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}
