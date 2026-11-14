//! What a scenario made the email backend do, written down while it runs.
//!
//! The coverage report (`cargo run -p xtask -- email-coverage report`) counts
//! an entry point as covered when a scenario caused it to run. This module
//! is where that is observed, from outside the services: the requests the
//! API and the GraphQL API served ([`crate::recording_proxy`]), the queue
//! messages the workers took and finished (the SQS traffic through
//! [`crate::aws`]), the Lambda runs, the tool calls, the provider calls the
//! emulators received, the events published to Kafka and the requests the
//! Macro service stand-ins got.
//!
//! The recorder knows nothing about the list of entry points. It keeps what
//! it saw, reduced to shapes ([`shape`]) so that mail and addresses stay out
//! of it, and a stack that finishes healthy writes it to [`FILE_NAME`] in
//! the scenario's log directory. Matching against the list happens in the
//! report.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use rootcause::prelude::*;
use serde_json::{Value, json};

#[cfg(test)]
mod test;

/// The file a finished scenario leaves in its log directory.
pub(crate) const FILE_NAME: &str = "evidence.json";
/// The version of the file's layout, for the report to refuse one it does
/// not know.
const VERSION: u8 = 1;
/// Provider routes of signing in, which a user of either provider may use
/// and which therefore do not say where an inbox is.
const SIGN_IN_ROUTES: &str = "oauth.";
/// The longest string a shape keeps as it is.
const TAG_LENGTH: usize = 48;
const TEXT: &str = "<str>";
const NOT_JSON: &str = "<not json>";
/// The path the GraphQL API is served at, in any service.
const GRAPHQL_SUFFIX: &str = "/graphql";
/// The variable nextest sets to the attempt a test run is.
const ATTEMPT_ENV: &str = "NEXTEST_ATTEMPT";

/// What happened to a queue message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum QueueStep {
    /// A service put it on the queue.
    Sent,
    /// A service took it from the queue.
    Received,
    /// A service deleted it, which a consumer does when it is done with it.
    Handled,
}

impl QueueStep {
    fn name(self) -> &'static str {
        match self {
            Self::Sent => "sent",
            Self::Received => "received",
            Self::Handled => "handled",
        }
    }
}

#[derive(Default)]
struct Seen {
    /// What was served to how often.
    http: BTreeMap<Request, u64>,
    /// What was asked to how often.
    graphql: BTreeMap<Asked, u64>,
    /// (queue URL, step, body shape) to how often.
    queue: BTreeMap<(String, QueueStep, String), u64>,
    /// Receipt handle to the queue URL and body shape of the message it is
    /// for, until the message is deleted.
    receipts: HashMap<String, (String, String)>,
    /// (function, succeeded) to how often.
    lambda: BTreeMap<(String, bool), u64>,
    /// (tool, succeeded) to how often.
    tools: BTreeMap<(String, bool), u64>,
}

/// A request as the record keeps it. Requests that differ only in content
/// (ids in the body, a search text) are one.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Request {
    service: String,
    method: String,
    path: String,
    /// The query's shape: see [`query_shape`].
    query: String,
    /// The body's [`shape`], as JSON text.
    body: String,
    status: u16,
}

/// A GraphQL request as the record keeps it.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Asked {
    service: String,
    query: String,
    /// The [`shape`] of the variables, as JSON text.
    variables: String,
    /// Whether the answer had data and no errors.
    answered: bool,
}

/// The record of one stack. Clones share it.
#[derive(Clone, Default)]
pub(crate) struct Recorder {
    seen: Arc<Mutex<Seen>>,
}

/// One request a recorded service answered.
pub(crate) struct Served<'a> {
    pub(crate) service: &'a str,
    pub(crate) method: &'a str,
    pub(crate) path: &'a str,
    pub(crate) query: Option<&'a str>,
    pub(crate) body: &'a [u8],
    pub(crate) status: u16,
    pub(crate) answer: &'a [u8],
}

impl Recorder {
    fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records a request a service answered.
    pub(crate) fn served(&self, served: &Served<'_>) {
        let service = served.service.to_owned();
        let graphql = served.path.ends_with(GRAPHQL_SUFFIX);
        let mut seen = self.seen();
        *seen
            .http
            .entry(Request {
                service: service.clone(),
                method: served.method.to_owned(),
                path: path_shape(served.path),
                query: query_shape(served.query.unwrap_or_default()),
                // A GraphQL request is kept by its query below.
                body: if graphql {
                    Value::Null.to_string()
                } else {
                    shape_of_bytes(served.body)
                },
                status: served.status,
            })
            .or_default() += 1;

        if graphql
            && let Ok(request) = serde_json::from_slice::<Value>(served.body)
            && let Some(query) = request["query"].as_str()
        {
            let answered = serde_json::from_slice::<Value>(served.answer)
                .is_ok_and(|answer| answer["data"].is_object() && answer.get("errors").is_none());
            *seen
                .graphql
                .entry(Asked {
                    service,
                    query: query.to_owned(),
                    variables: shape(&request["variables"]).to_string(),
                    answered,
                })
                .or_default() += 1;
        }
    }

    /// Records one SQS call of a service: `operation` is the end of its
    /// `x-amz-target`, `request` and `answer` its JSON bodies.
    pub(crate) fn queue_call(&self, operation: &str, request: &[u8], answer: &[u8]) {
        let Ok(request) = serde_json::from_slice::<Value>(request) else {
            return;
        };
        let queue = request["QueueUrl"].as_str().unwrap_or_default().to_owned();
        let mut seen = self.seen();
        match operation {
            "SendMessage" => {
                let shape = shape_of_text(request["MessageBody"].as_str());
                *seen
                    .queue
                    .entry((queue, QueueStep::Sent, shape))
                    .or_default() += 1;
            }
            "SendMessageBatch" => {
                for entry in request["Entries"].as_array().into_iter().flatten() {
                    let shape = shape_of_text(entry["MessageBody"].as_str());
                    *seen
                        .queue
                        .entry((queue.clone(), QueueStep::Sent, shape))
                        .or_default() += 1;
                }
            }
            "ReceiveMessage" => {
                let Ok(answer) = serde_json::from_slice::<Value>(answer) else {
                    return;
                };
                for message in answer["Messages"].as_array().into_iter().flatten() {
                    let shape = shape_of_text(message["Body"].as_str());
                    if let Some(handle) = message["ReceiptHandle"].as_str() {
                        seen.receipts
                            .insert(handle.to_owned(), (queue.clone(), shape.clone()));
                    }
                    *seen
                        .queue
                        .entry((queue.clone(), QueueStep::Received, shape))
                        .or_default() += 1;
                }
            }
            "DeleteMessage" => {
                if let Some(handle) = request["ReceiptHandle"].as_str() {
                    handled(&mut seen, handle);
                }
            }
            "DeleteMessageBatch" => {
                for entry in request["Entries"].as_array().into_iter().flatten() {
                    if let Some(handle) = entry["ReceiptHandle"].as_str() {
                        handled(&mut seen, handle);
                    }
                }
            }
            _ => {}
        }
    }

    /// Records one run of the Lambda binary `function`.
    pub(crate) fn lambda_ran(&self, function: &str, succeeded: bool) {
        *self
            .seen()
            .lambda
            .entry((function.to_owned(), succeeded))
            .or_default() += 1;
    }

    /// Records one call of the AI tool `tool`.
    pub(crate) fn tool_called(&self, tool: &str, succeeded: bool) {
        *self
            .seen()
            .tools
            .entry((tool.to_owned(), succeeded))
            .or_default() += 1;
    }

    /// Writes the record to `log_dir`, with what the stack collected at its
    /// end (`collected`: its inboxes, the provider calls, the events and the
    /// stand-ins' requests) and each queue URL replaced by the name in `queue_names`.
    pub(crate) fn write(
        &self,
        log_dir: &Path,
        queue_names: &BTreeMap<String, String>,
        collected: Collected,
    ) -> Result<(), Report> {
        let seen = self.seen();
        let name = |url: &String| {
            queue_names
                .get(url)
                .cloned()
                .unwrap_or_else(|| url.rsplit('/').next().unwrap_or_default().to_owned())
        };
        // An inbox the scenario removed is no longer among its links: the
        // mailbox calls made for it still say which provider it was on.
        let called = collected.provider.iter().filter_map(|call| {
            let route = call["route"].as_str()?;
            (!route.starts_with(SIGN_IN_ROUTES)).then(|| call["provider"].as_str())?
        });
        let providers: BTreeSet<String> = collected
            .links
            .iter()
            .map(|(provider, _)| provider.as_str())
            .chain(called)
            .map(str::to_ascii_lowercase)
            .collect();
        let (binary, test) = scenario();
        let evidence = json!({
            "version": VERSION,
            "binary": binary,
            "test": test,
            "attempt": attempt(),
            "providers": providers,
            "links": collected.links.len(),
            "http": seen.http.iter().map(|(request, count)| json!({
                "service": request.service, "method": request.method, "path": request.path,
                "query": request.query, "body": parsed(&request.body),
                "status": request.status, "count": count,
            })).collect::<Vec<_>>(),
            "graphql": seen.graphql.iter().map(|(asked, count)| json!({
                "service": asked.service, "query": asked.query,
                "variables": parsed(&asked.variables),
                "answered": asked.answered, "count": count,
            })).collect::<Vec<_>>(),
            "queue": seen.queue.iter().map(|((queue, step, body), count)| json!({
                "queue": name(queue), "step": step.name(), "body": parsed(body), "count": count,
            })).collect::<Vec<_>>(),
            "lambda": seen.lambda.iter().map(|((function, succeeded), count)| json!({
                "function": function, "succeeded": succeeded, "count": count,
            })).collect::<Vec<_>>(),
            "tools": seen.tools.iter().map(|((tool, succeeded), count)| json!({
                "tool": tool, "succeeded": succeeded, "count": count,
            })).collect::<Vec<_>>(),
            "provider": collected.provider,
            "kafka": collected.kafka,
            "services": collected.services,
        });
        drop(seen);
        let text = serde_json::to_string(&evidence).context("could not write the evidence")?;
        std::fs::write(log_dir.join(FILE_NAME), text)
            .context("could not write the scenario's evidence file")?;
        Ok(())
    }
}

fn handled(seen: &mut Seen, handle: &str) {
    if let Some((queue, shape)) = seen.receipts.remove(handle) {
        *seen
            .queue
            .entry((queue, QueueStep::Handled, shape))
            .or_default() += 1;
    }
}

/// What a stack reads off its other parts when it finishes.
#[derive(Default)]
pub(crate) struct Collected {
    /// The inboxes the scenario linked: (provider, link id).
    pub(crate) links: Vec<(String, String)>,
    /// The provider calls: `{provider, route, method, path, status, count}`,
    /// `route` null for a request the emulator matched to no API method.
    pub(crate) provider: Vec<Value>,
    /// The events of the scenario's inboxes: `{topic, event, count}`.
    pub(crate) kafka: Vec<Value>,
    /// The requests to the Macro service stand-ins:
    /// `{service, method, path, body, count}`.
    pub(crate) services: Vec<Value>,
}

/// Counts equal items: each distinct one once, with `count` added.
pub(crate) fn counted(items: impl IntoIterator<Item = Value>) -> Vec<Value> {
    let mut counts: BTreeMap<String, (Value, u64)> = BTreeMap::new();
    for item in items {
        let entry = counts.entry(item.to_string()).or_insert((item, 0));
        entry.1 += 1;
    }
    counts
        .into_values()
        .map(|(mut item, count)| {
            if let Some(fields) = item.as_object_mut() {
                fields.insert("count".to_owned(), json!(count));
            }
            item
        })
        .collect()
}

/// A path with every segment that is not a plain word replaced by `{}`, so
/// that ids and addresses stay out of the record.
pub(crate) fn path_shape(path: &str) -> String {
    let path = path.split('?').next().unwrap_or_default();
    path.split('/')
        .map(|segment| {
            if segment.is_empty() || is_tag(segment) {
                segment
            } else {
                "{}"
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// The shape of a JSON value: its keys, with every value that could be
/// content replaced. A string stays only when it reads as a tag (a short
/// word such as an enum variant's name), which is what tells one kind of
/// message from another; a list keeps the shape of its first item, and a
/// boolean stays as it is.
pub(crate) fn shape(value: &Value) -> Value {
    match value {
        Value::Null => Value::Null,
        // Not content, and often what tells one action from its opposite.
        Value::Bool(flag) => json!(flag),
        Value::Number(_) => json!(0),
        Value::String(text) if is_tag(text) => json!(text),
        Value::String(_) => json!(TEXT),
        Value::Array(items) => Value::Array(items.first().map(shape).into_iter().collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), shape(value)))
                .collect(),
        ),
    }
}

/// Whether `text` reads as a tag: a short run of letters, `_`, `.` and `-`.
fn is_tag(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= TAG_LENGTH
        && text.starts_with(|first: char| first.is_ascii_alphabetic())
        && text
            .chars()
            .all(|character| character.is_ascii_alphabetic() || "_.-".contains(character))
}

/// The shape of a query string: its keys in order, each with its value when
/// that reads as a tag (`view=inbox`) and alone otherwise (`cursor`).
fn query_shape(query: &str) -> String {
    let mut pairs: Vec<String> = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((key, value)) if is_tag(value) => format!("{key}={value}"),
            Some((key, _)) => key.to_owned(),
            None => pair.to_owned(),
        })
        .collect();
    pairs.sort_unstable();
    pairs.dedup();
    pairs.join("&")
}

fn shape_of_bytes(body: &[u8]) -> String {
    if body.is_empty() {
        return Value::Null.to_string();
    }
    match serde_json::from_slice::<Value>(body) {
        Ok(value) => shape(&value).to_string(),
        Err(_) => json!(NOT_JSON).to_string(),
    }
}

fn shape_of_text(body: Option<&str>) -> String {
    shape_of_bytes(body.unwrap_or_default().as_bytes())
}

fn parsed(shape: &str) -> Value {
    serde_json::from_str(shape).unwrap_or(Value::Null)
}

/// The test binary and the test this thread runs, as nextest names them:
/// `sync_linking` and `gmail_links_an_inbox`.
fn scenario() -> (String, String) {
    let binary = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
        .map(|stem| match stem.rsplit_once('-') {
            // Cargo ends a test binary's name with a hash.
            Some((name, hash)) if hash.chars().all(|digit| digit.is_ascii_hexdigit()) => {
                name.to_owned()
            }
            _ => stem,
        })
        .unwrap_or_default();
    let test = std::thread::current().name().unwrap_or_default().to_owned();
    (binary, test)
}

/// Which attempt of the test this is: 1 unless nextest is retrying it.
fn attempt() -> u32 {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: nextest tells a test its attempt through the process environment"
    )]
    let attempt = std::env::var(ATTEMPT_ENV);
    attempt
        .ok()
        .and_then(|attempt| attempt.parse().ok())
        .unwrap_or(1)
}
