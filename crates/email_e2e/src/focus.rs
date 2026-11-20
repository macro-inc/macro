//! What `email_focus_worker` asks outside Macro's own database, stood in
//! for: the model that answers the Focus questions about a thread, the
//! agent harness route that reads the day a thread is due and the day of
//! the meeting it is about, and PostHog,
//! whose `enable-email-focus` flag puts a user's inboxes, and those linked
//! to them, in the Focus rollout.
//!
//! The questions, their order and the thread ids are the product's, so a
//! scenario does not script answers by them. It says which mail belongs in
//! Focus by a piece of text that mail holds (its subject, say), and the
//! model stand-in answers "yes" to the first question, whether the owner
//! would want the thread in Focus, exactly for the requests that hold such
//! text. Every other question is answered "no", so nothing but that answer
//! decides.
//!
//! Every user has the flag on unless the scenario turned it off for them
//! ([`FocusClassifier::turn_off_focus_flag_for`]).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header::AUTHORIZATION};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use rootcause::prelude::*;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

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
/// The question whether the latest message asks the owner something they haven't
/// answered, seventh in `FocusQuestion::ALL`.
const NEEDS_RESPONSE_QUESTION: &str = "q6";
/// The key the worker is given for the model API, which the stand-in asks
/// for as the API does.
pub(crate) const MODEL_API_KEY: &str = "email-e2e";
/// Where the worker reads the flag definitions, at the PostHog host.
const FLAG_DEFINITIONS_ROUTE: &str = "/flags/definitions";
/// The PostHog project key and secret key the worker is given, which the
/// stand-in asks for as PostHog does.
pub(crate) const POSTHOG_PROJECT_KEY: &str = "email-e2e-project";
pub(crate) const POSTHOG_SECRET_KEY: &str = "email-e2e-flags";
/// The flag that puts a user's inboxes, and those linked to them, in the
/// Focus rollout
/// (`EMAIL_FOCUS_FLAG` in `email_focus_worker`).
const FOCUS_FLAG: &str = "enable-email-focus";
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
    /// Text that marks mail as asking the owner something.
    asks_owner: Vec<String>,
    /// Text that marks mail as due, with the day.
    due: Vec<(String, NaiveDate)>,
    /// Text that marks mail as about a meeting, with the meeting's day.
    events: Vec<(String, NaiveDate)>,
    /// The input of every question the model was asked, oldest first. Kept
    /// in memory for [`FocusClassifier::times_asked_about`] only: it is
    /// mail, and never reaches the scenario's record.
    asked: Vec<String>,
    /// The stand-in and route of every request, oldest first.
    calls: Vec<(&'static str, &'static str)>,
    /// The addresses of the users whose Focus flag is off.
    flag_off: Vec<String>,
    /// Whether the worker has read the flag definitions, which it reads
    /// again only five minutes later.
    flag_read: bool,
}

/// The model, the due date reader and the Focus flag the Focus worker asks,
/// as a scenario sets them
/// ([`Stack::focus_classifier`](crate::Stack::focus_classifier)). Until told
/// otherwise the model finds no mail worth Focus, no thread has a due date
/// and every user has the flag on.
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

    /// From now on the model says a thread's latest message asks the owner
    /// something they haven't answered when what the worker shows it holds
    /// `text`.
    pub fn ask_the_owner_when_mail_contains(&self, text: &str) {
        self.answers().asks_owner.push(text.to_owned());
    }

    /// From now on the agent harness reads `day` as the day a thread is due
    /// when the thread's subject or messages hold `text`.
    pub fn due_on_when_mail_contains(&self, text: &str, day: NaiveDate) {
        self.answers().due.push((text.to_owned(), day));
    }

    /// From now on the agent harness reads `day` as the day of the meeting a
    /// thread is about when the thread's subject or messages hold `text`.
    pub fn event_on_when_mail_contains(&self, text: &str, day: NaiveDate) {
        self.answers().events.push((text.to_owned(), day));
    }

    /// Turns the Focus flag off for the user at `address`, so the worker
    /// classifies the mail of their inboxes, and of those linked to them, only
    /// while another user the inbox belongs or is linked to has the flag.
    ///
    /// The worker reads the flag when it first looks at an inbox, mail or no
    /// mail (it looks at every linked inbox once a minute), and again only
    /// five minutes later, so this fails once it has: turn the flag off
    /// before linking any inbox.
    pub fn turn_off_focus_flag_for(&self, address: &str) -> Result<(), Report> {
        let mut answers = self.answers();
        if answers.flag_read {
            bail!(
                "the Focus worker has read the flag already: turn it off for {address} before \
                 linking any inbox"
            );
        }
        answers.flag_off.push(address.to_owned());
        Ok(())
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
    /// Starts the server the stand-ins answer on.
    pub(crate) async fn start() -> Result<Self, Report> {
        let classifier = FocusClassifier::default();
        let listener = crate::host::local_listener()
            .await
            .context("could not bind the Focus stand-ins")?;
        let address = listener.local_addr()?;
        let app = Router::new()
            .route(&format!("/{MODEL_API}{EVALUATE_ROUTE}"), post(evaluate))
            .route(&format!("/{AGENT_HARNESS}{DUE_DATE_ROUTE}"), post(due_date))
            .route(FLAG_DEFINITIONS_ROUTE, get(flag_definitions))
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

    /// The PostHog host the worker reads its flag from: an origin, as
    /// PostHog's is.
    pub(crate) fn flags_url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// Stops the server.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

/// The model: every question asked gets an answer, "yes" only to the Focus
/// question, and to whether the latest message asks the owner something, about
/// mail the scenario marked. The wire shape is the one
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
    let asks_owner = answers.asks_owner.iter().any(|text| input.contains(text));
    answers.asked.push(input);
    answers.calls.push((MODEL_API, EVALUATE_ROUTE));
    let answered: serde_json::Map<String, Value> = request["questions"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, _)| {
            let yes =
                (in_focus && id == FOCUS_QUESTION) || (asks_owner && id == NEEDS_RESPONSE_QUESTION);
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

/// The agent harness's due date route: the due day and the meeting's day
/// the scenario set for mail the thread holds, or none.
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
    let day_for = |days: &[(String, NaiveDate)]| {
        days.iter()
            .find(|(text, _)| thread.contains(text))
            .map(|(_, day)| day.format("%Y-%m-%d").to_string())
    };
    let (due_on, event_on) = (day_for(&answers.due), day_for(&answers.events));
    Json(json!({ "due_on": due_on, "event_on": event_on })).into_response()
}

/// A header's value, empty when it is missing or not text.
fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

/// PostHog's flag definitions, which the worker polls to evaluate
/// `enable-email-focus` itself: on for every user but those the scenario
/// turned it off for. The wire shape is the one
/// `feature_flags::outbound::posthog_local` reads.
async fn flag_definitions(
    State(classifier): State<FocusClassifier>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let bearer = format!("Bearer {POSTHOG_SECRET_KEY}");
    if header(&headers, AUTHORIZATION.as_str()) != bearer
        || query.get("token").map(String::as_str) != Some(POSTHOG_PROJECT_KEY)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut answers = classifier.answers();
    answers.flag_read = true;
    // The worker's evaluator refuses an `is_not` without a value.
    let properties = if answers.flag_off.is_empty() {
        json!([])
    } else {
        json!([{
            "key": "email",
            "type": "person",
            "operator": "is_not",
            "value": answers.flag_off,
        }])
    };
    Json(json!({
        "flags": [{
            "key": FOCUS_FLAG,
            "active": true,
            "filters": {
                "groups": [{ "properties": properties, "rollout_percentage": 100 }],
            },
        }],
    }))
    .into_response()
}
