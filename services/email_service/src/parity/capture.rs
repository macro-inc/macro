//! A process-wide subscriber follows each step's root into detached publish tasks.

use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, OnceLock};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

mod test;

const TIMING_THRESHOLD_EVENTS: [(&str, &str); 2] = [
    ("macro_tower_layers", "slow http request"),
    ("macro_tower_layers", "tokio runtime starvation detected"),
];

type Fields = BTreeMap<String, Value>;

#[derive(Default)]
struct Visitor(Fields);
impl Visit for Visitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0
            .insert(field.name().into(), json!(format!("{value:?}")));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0.insert(field.name().into(), json!(value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.insert(field.name().into(), json!(value));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0.insert(field.name().into(), json!(value));
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0.insert(field.name().into(), json!(value));
    }
}

#[derive(Default)]
pub(super) struct Recording {
    spans: Vec<Span>,
    logs: Vec<Value>,
    sql: Vec<Value>,
    callsites: BTreeSet<(String, String, String)>,
    timing_event_counts: [u64; TIMING_THRESHOLD_EVENTS.len()],
    open_requests: usize,
    closed: Arc<tokio::sync::Notify>,
}

struct Span {
    parent: Option<usize>,
    name: String,
    level: String,
    fields: Fields,
}

impl Span {
    fn exported(&self) -> bool {
        matches!(self.level.as_str(), "ERROR" | "WARN" | "INFO")
    }
}

#[derive(Clone)]
struct Location {
    recording: Arc<Mutex<Recording>>,
    index: Option<usize>,
}

#[derive(Clone, Default)]
struct Capture;

static DISPATCH: OnceLock<tracing::Dispatch> = OnceLock::new();
struct ActiveStep {
    runtime: tokio::runtime::Id,
    recording: Arc<Mutex<Recording>>,
}

static ACTIVE_STEP: Mutex<Option<ActiveStep>> = Mutex::new(None);
static LAB_GATE: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
tokio::task_local! {
    static ACTIVE: Arc<Mutex<Recording>>;
}
thread_local! {
    static STARTING: std::cell::RefCell<Option<Arc<Mutex<Recording>>>> = const { std::cell::RefCell::new(None) };
}

pub(super) fn dispatch() -> tracing::Dispatch {
    DISPATCH
        .get_or_init(|| {
            let dispatch = tracing::Dispatch::new(tracing_subscriber::registry().with(Capture));
            // Each parity test runs in its own nextest process. The cancellation
            // shield does not inherit a scoped dispatcher, so capture needs this
            // global subscriber; plain libtest returns before reaching here.
            tracing::dispatcher::set_global_default(dispatch.clone()).expect("parity subscriber");
            tracing::callsite::rebuild_interest_cache();
            dispatch
        })
        .clone()
}

pub(super) fn start() -> (Arc<Mutex<Recording>>, tracing::Span) {
    let recording = Arc::new(Mutex::new(Recording::default()));
    *ACTIVE_STEP.lock().expect("active step mutex") = Some(ActiveStep {
        runtime: tokio::runtime::Handle::current().id(),
        recording: recording.clone(),
    });
    let dispatch = dispatch();
    let span = tracing::dispatcher::with_default(&dispatch, || {
        STARTING.with(|slot| *slot.borrow_mut() = Some(recording.clone()));
        let span = tracing::info_span!(parent: None, "parity.step");
        STARTING.with(|slot| slot.borrow_mut().take());
        span
    });
    (recording, span)
}

pub(super) fn stop() {
    ACTIVE_STEP.lock().expect("active step mutex").take();
}

pub(super) async fn exclusive_lab() -> tokio::sync::OwnedMutexGuard<()> {
    LAB_GATE
        .get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
        .lock_owned()
        .await
}

fn active_recording() -> Option<Arc<Mutex<Recording>>> {
    ACTIVE.try_with(Clone::clone).ok().or_else(|| {
        let runtime = tokio::runtime::Handle::try_current().ok()?.id();
        ACTIVE_STEP
            .lock()
            .expect("active step mutex")
            .as_ref()
            .filter(|step| step.runtime == runtime)
            .map(|step| step.recording.clone())
    })
}

pub(super) async fn scope<T>(
    recording: Arc<Mutex<Recording>>,
    future: impl Future<Output = T>,
) -> T {
    ACTIVE.scope(recording, future).await
}

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> tracing_subscriber::Layer<S> for Capture {
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let current = ctx.span(id).expect("new span");
        let inherited = current
            .parent()
            .and_then(|parent| parent.extensions().get::<Location>().cloned());
        let location = inherited.or_else(|| {
            STARTING
                .with(|slot| slot.borrow().clone())
                .or_else(active_recording)
                .map(|recording| Location {
                    recording,
                    index: None,
                })
        });
        let Some(mut location) = location else { return };
        if attrs.metadata().name() != "parity.step" {
            let mut fields = Visitor::default();
            attrs.record(&mut fields);
            let mut recording = location.recording.lock().expect("recording mutex");
            let index = recording.spans.len();
            if attrs.metadata().name() == "http.request" {
                recording.open_requests += 1;
            }
            recording.callsites.insert((
                "span".into(),
                attrs.metadata().target().into(),
                attrs.metadata().name().into(),
            ));
            recording.spans.push(Span {
                parent: location.index,
                name: attrs.metadata().name().into(),
                level: attrs.metadata().level().to_string(),
                fields: fields.0,
            });
            location.index = Some(index);
        }
        current.extensions_mut().insert(location);
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let extensions = span.extensions();
        let Some(location) = extensions.get::<Location>() else {
            return;
        };
        if let Some(index) = location.index {
            let mut fields = Visitor::default();
            values.record(&mut fields);
            location.recording.lock().expect("recording mutex").spans[index]
                .fields
                .extend(fields.0);
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let extensions = span.extensions();
        let Some(location) = extensions.get::<Location>() else {
            return;
        };
        if let Some(index) = location.index {
            let mut recording = location.recording.lock().expect("recording mutex");
            if recording.spans[index].name == "http.request" {
                recording.open_requests -= 1;
                recording.closed.notify_one();
            }
        }
    }

    fn on_event(&self, event: &tracing::Event<'_>, ctx: Context<'_, S>) {
        let mut fields = Visitor::default();
        event.record(&mut fields);
        let metadata = event.metadata();
        let timing_event = TIMING_THRESHOLD_EVENTS
            .iter()
            .position(|(target, message)| {
                *target == metadata.target()
                    && fields.0.get("message").and_then(Value::as_str) == Some(*message)
            });
        let location = ctx
            .event_span(event)
            .and_then(|span| span.extensions().get::<Location>().cloned())
            .or_else(|| {
                // Only events from the request task or one of its captured
                // spans belong to the step. Unscoped process monitors (such as
                // the tower runtime starvation detector) are independent work.
                ACTIVE
                    .try_with(Clone::clone)
                    .ok()
                    .map(|recording| Location {
                        recording,
                        index: None,
                    })
            })
            .or_else(|| {
                // Count the named process timing events during an active step,
                // without treating them as request behavior.
                timing_event
                    .and_then(|_| active_recording())
                    .map(|recording| Location {
                        recording,
                        index: None,
                    })
            });
        let Some(location) = location else { return };
        let mut recording = location.recording.lock().expect("recording mutex");
        if let Some(index) = timing_event {
            recording.timing_event_counts[index] += 1;
            return;
        }
        if metadata.target() == "sqlx::query" {
            // Statement logging is separate from normal logs, including DEBUG statements.
            recording.sql.push(json!(fields.0));
        } else if *metadata.level() <= tracing::Level::INFO
            || (*metadata.level() == tracing::Level::DEBUG
                && metadata
                    .target()
                    .starts_with("email_service::pubsub::inbox_sync::"))
        {
            // Worker DEBUG identities prove branch coverage without recording
            // third-party messages containing timing or connection-pool noise.
            let message = fields.0.remove("message").unwrap_or(Value::Null);
            recording.callsites.insert((
                "event".into(),
                metadata.target().into(),
                message.as_str().unwrap_or("").into(),
            ));
            if *metadata.level() <= tracing::Level::INFO {
                recording
                    .logs
                    .push(json!({"level": metadata.level().to_string(),
                    "span": location.index, "message": message, "fields": fields.0}));
            }
        }
    }
}

impl Recording {
    pub fn sections(&self) -> (Value, Value, Value, Value, Value) {
        let full_spans: Vec<_> = self.spans.iter().map(|span| json!({
            "parent": span.parent, "name": span.name, "level": span.level, "fields": span.fields,
        })).collect();
        let mut kept = vec![None; self.spans.len()];
        let mut spans = Vec::new();
        for (index, span) in self.spans.iter().enumerate() {
            if !span.exported() {
                continue;
            }
            let mut parent = span.parent;
            while let Some(index) = parent {
                if kept[index].is_some() {
                    break;
                }
                parent = self.spans[index].parent;
            }
            kept[index] = Some(spans.len());
            spans.push(
                json!({"parent":parent.and_then(|p| kept[p]), "name":span.name,
                "level":span.level,"fields":span.fields}),
            );
        }
        let mut statements = Vec::<String>::new();
        let mut sequence = Vec::new();
        for fields in &self.sql {
            let sql = fields["db.statement"].as_str().unwrap_or("");
            let sql = if sql.trim().is_empty() {
                fields["summary"].as_str().unwrap_or("")
            } else {
                sql
            };
            let statement = sql.split_whitespace().collect::<Vec<_>>().join(" ");
            let index = statements
                .iter()
                .position(|s| *s == statement)
                .unwrap_or_else(|| {
                    statements.push(statement);
                    statements.len() - 1
                });
            sequence.push(json!({"statement": index + 1,
                "rows_affected": fields["rows_affected"], "rows_returned": fields["rows_returned"]}));
        }
        let logs: Vec<_> = self
            .logs
            .iter()
            .cloned()
            .map(|mut log| {
                let mut path = Vec::new();
                let mut index = log["span"].as_u64().map(|n| n as usize);
                while let Some(i) = index {
                    if self.spans[i].exported() {
                        path.push(self.spans[i].name.clone());
                    }
                    index = self.spans[i].parent;
                }
                path.reverse();
                log["span"] = json!(path);
                log
            })
            .collect();
        (
            json!(spans),
            json!(logs),
            json!({"statements": statements.into_iter().enumerate().map(|(index, sql)| json!({"id":index+1,"sql":sql})).collect::<Vec<_>>(), "sequence": sequence}),
            json!({"callsites": self.callsites, "excluded_timing_events":
                TIMING_THRESHOLD_EVENTS.iter().zip(self.timing_event_counts).map(|((target,message),count)|
                    json!({"target":target,"message":message,"count":count})).collect::<Vec<_>>() }),
            json!(full_spans),
        )
    }
}

/// Wait on request-span ownership, including clones carried by detached work.
/// Connection-pool spans can outlive requests and must not delay this boundary.
/// Only suites with such work opt in; existing transcript boundaries stay intact.
pub(super) async fn drain(recording: &Arc<Mutex<Recording>>) {
    let closed = recording.lock().expect("recording mutex").closed.clone();
    loop {
        let notified = closed.notified();
        if recording.lock().expect("recording mutex").open_requests == 0 {
            return;
        }
        notified.await;
    }
}
