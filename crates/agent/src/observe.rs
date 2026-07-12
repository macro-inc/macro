//! Agent-run observability: a fire-and-forget observer port over the agent
//! loop lifecycle, plus an outbound adapter that ships events to a local
//! [0rrery](https://github.com/0ponn/0rrery) collector.
//!
//! The port mirrors [`ai_usage::UsageRecorder`]'s contract: every method is
//! infallible and best-effort — an observer must never slow down or fail the
//! originating agent call. The default observer is resolved from the
//! environment once per process (like `ModelRouter::shared`): when
//! `ORRERY_URL` is unset, [`shared`] is `None` and the loop runs exactly as
//! before.

use ai_usage::UsageContext;
#[cfg(feature = "orrery")]
use macro_env_var::maybe_env_var;
use std::sync::Arc;
#[cfg(feature = "orrery")]
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(feature = "orrery")]
use std::time::{SystemTime, UNIX_EPOCH};

/// The `source`/`project` this emitter reports to 0rrery.
#[cfg(feature = "orrery")]
const MACRO_SOURCE: &str = "macro";
/// Per-post budget: a slow collector drops events, never delays the agent.
#[cfg(feature = "orrery")]
const EMIT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

#[cfg(feature = "orrery")]
maybe_env_var! {
    /// Base URL of a 0rrery collector (e.g. `http://localhost:7317`). Setting
    /// it turns agent-run observation on; unset (the default) disables it.
    pub struct OrreryUrl;
}
#[cfg(feature = "orrery")]
maybe_env_var! {
    /// Optional bearer token for the 0rrery collector's ingest endpoint.
    pub struct OrreryToken;
}

/// The constant attributes of one agent session, reported on
/// [`AgentObserver::session_started`].
#[derive(Debug)]
pub struct SessionMeta<'a> {
    /// The AI feature running the session (e.g. `chat`).
    pub feature: &'a str,
    /// The user the session runs for.
    pub user: &'a str,
    /// The entity the session relates to, if any.
    pub entity: Option<String>,
    /// The model api id serving the session.
    pub model: &'a str,
}

/// Observes the agent-loop lifecycle. All methods are fire-and-forget: they
/// must be cheap, must not block, and must never fail the originating call.
pub trait AgentObserver: Send + Sync {
    /// A session was created.
    fn session_started(&self, session_id: &str, meta: &SessionMeta<'_>);
    /// One `send_message` exchange began; `span_id` identifies it.
    fn message_started(&self, session_id: &str, span_id: &str);
    /// The model requested a tool call.
    fn tool_started(&self, session_id: &str, parent_span_id: &str, call_id: &str, name: &str);
    /// A tool call produced its result (`ok` = the tool returned valid output).
    fn tool_finished(
        &self,
        session_id: &str,
        parent_span_id: &str,
        call_id: &str,
        name: &str,
        ok: bool,
    );
    /// A completion round-trip finished with the given token usage.
    fn llm_usage(
        &self,
        session_id: &str,
        parent_span_id: &str,
        span_id: &str,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
    );
    /// The `send_message` exchange ended (`ok` = the stream ended without error).
    fn message_finished(&self, session_id: &str, span_id: &str, ok: bool);
    /// The session was dropped.
    fn session_ended(&self, session_id: &str);
}

/// The process-wide observer, resolved from the environment on first use.
/// `None` (the default, when `ORRERY_URL` is unset) means observation is off.
pub(crate) fn shared() -> Option<Arc<dyn AgentObserver>> {
    #[cfg(feature = "orrery")]
    {
        static OBSERVER: OnceLock<Option<Arc<dyn AgentObserver>>> = OnceLock::new();
        OBSERVER
            .get_or_init(|| {
                OrreryObserver::from_env().map(|o| Arc::new(o) as Arc<dyn AgentObserver>)
            })
            .clone()
    }
    #[cfg(not(feature = "orrery"))]
    None
}

/// Per-session observer state: owns the session id and emits `session_ended`
/// when the last holder (the session or an in-flight stream driver) drops it.
pub(crate) struct ObserveHandle {
    observer: Arc<dyn AgentObserver>,
    session_id: String,
    messages: AtomicU64,
}

impl ObserveHandle {
    /// Create the handle and report `session_started`.
    pub(crate) fn start(
        observer: Arc<dyn AgentObserver>,
        usage_ctx: &UsageContext,
        model: &str,
    ) -> Arc<Self> {
        let session_id = format!("macro:{}", uuid::Uuid::now_v7());
        let feature = usage_ctx.feature.to_string();
        observer.session_started(
            &session_id,
            &SessionMeta {
                feature: &feature,
                user: usage_ctx.user.as_ref(),
                entity: usage_ctx.entity.map(|e| e.to_string()),
                model,
            },
        );
        Arc::new(Self {
            observer,
            session_id,
            messages: AtomicU64::new(0),
        })
    }

    /// Begin one `send_message` exchange and report `message_started`.
    pub(crate) fn begin_message(self: &Arc<Self>) -> Arc<MessageObserve> {
        let n = self.messages.fetch_add(1, Ordering::Relaxed);
        let span_id = format!("{}:msg:{n}", self.session_id);
        self.observer.message_started(&self.session_id, &span_id);
        Arc::new(MessageObserve {
            handle: self.clone(),
            span_id,
            llm_calls: AtomicU64::new(0),
            finished: AtomicBool::new(false),
        })
    }
}

impl Drop for ObserveHandle {
    fn drop(&mut self) {
        self.observer.session_ended(&self.session_id);
    }
}

/// Observer state for one `send_message` exchange, shared by the stream bridge
/// (tool spans) and the stream driver (usage, finish).
pub(crate) struct MessageObserve {
    handle: Arc<ObserveHandle>,
    span_id: String,
    llm_calls: AtomicU64,
    finished: AtomicBool,
}

impl MessageObserve {
    /// Report a tool call starting.
    pub(crate) fn tool_started(&self, call_id: &str, name: &str) {
        self.handle
            .observer
            .tool_started(&self.handle.session_id, &self.span_id, call_id, name);
    }

    /// Report a tool call finishing.
    pub(crate) fn tool_finished(&self, call_id: &str, name: &str, ok: bool) {
        self.handle.observer.tool_finished(
            &self.handle.session_id,
            &self.span_id,
            call_id,
            name,
            ok,
        );
    }

    /// Report one completion round-trip's token usage.
    pub(crate) fn llm_usage(&self, model: &str, input_tokens: u64, output_tokens: u64) {
        let n = self.llm_calls.fetch_add(1, Ordering::Relaxed);
        self.handle.observer.llm_usage(
            &self.handle.session_id,
            &self.span_id,
            &format!("{}:llm:{n}", self.span_id),
            model,
            input_tokens,
            output_tokens,
        );
    }

    /// Report the exchange finishing. Idempotent: only the first call emits.
    pub(crate) fn finish(&self, ok: bool) {
        if self.finished.swap(true, Ordering::Relaxed) {
            return;
        }
        self.handle
            .observer
            .message_finished(&self.handle.session_id, &self.span_id, ok);
    }
}

/// Fallback close: an aborted stream (client drop / cancellation) never reaches
/// the driver's `finish` call, so close the span as not-ok here. The `Arc` to
/// the session's [`ObserveHandle`] is still held at this point, so this always
/// emits before `session_ended`.
impl Drop for MessageObserve {
    fn drop(&mut self) {
        self.finish(false);
    }
}

/// Milliseconds since the Unix epoch.
#[cfg(feature = "orrery")]
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Ships observer events to a 0rrery collector as `IngestOp` batches on
/// `POST {ORRERY_URL}/api/ingest`. Posts are spawned fire-and-forget with a
/// short timeout, mirroring 0rrery's own emitter semantics: a slow or absent
/// collector drops events, never the agent call.
#[cfg(feature = "orrery")]
pub struct OrreryObserver {
    ingest_url: String,
    token: Option<String>,
    client: reqwest::Client,
}

#[cfg(feature = "orrery")]
impl OrreryObserver {
    /// Build from `ORRERY_URL` / `ORRERY_TOKEN`, or `None` when unset.
    pub fn from_env() -> Option<Self> {
        let url = OrreryUrl::new()?;
        let base = url.value()?.trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(EMIT_TIMEOUT)
            .build()
            .ok()?;
        Some(Self {
            ingest_url: format!("{base}/api/ingest"),
            token: OrreryToken::new().and_then(|t| t.value().map(str::to_string)),
            client,
        })
    }

    fn post(&self, ops: Vec<serde_json::Value>) {
        // Observation must never block or fail the agent call: skip when no
        // runtime is available (e.g. a session dropped outside tokio).
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let mut request = self.client.post(&self.ingest_url).json(&ops);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        runtime.spawn(async move {
            if let Err(e) = request.send().await {
                tracing::debug!(error = ?e, "0rrery ingest post failed (dropped)");
            }
        });
    }
}

#[cfg(feature = "orrery")]
impl AgentObserver for OrreryObserver {
    fn session_started(&self, session_id: &str, meta: &SessionMeta<'_>) {
        self.post(vec![serde_json::json!({
            "op": "session.start",
            "sessionId": session_id,
            "source": MACRO_SOURCE,
            "project": MACRO_SOURCE,
            "ts": now_ms(),
            "meta": {
                "feature": meta.feature,
                "user": meta.user,
                "entity": meta.entity,
                "model": meta.model,
            },
        })]);
    }

    fn message_started(&self, session_id: &str, span_id: &str) {
        self.post(vec![serde_json::json!({
            "op": "span.start",
            "id": span_id,
            "sessionId": session_id,
            "parentId": null,
            "kind": "agent",
            "name": "send_message",
            "ts": now_ms(),
        })]);
    }

    fn tool_started(&self, session_id: &str, parent_span_id: &str, call_id: &str, name: &str) {
        self.post(vec![serde_json::json!({
            "op": "span.start",
            "id": format!("{parent_span_id}:tool:{call_id}"),
            "sessionId": session_id,
            "parentId": parent_span_id,
            "kind": "tool",
            "name": name,
            "ts": now_ms(),
        })]);
    }

    fn tool_finished(
        &self,
        _session_id: &str,
        parent_span_id: &str,
        call_id: &str,
        _name: &str,
        ok: bool,
    ) {
        self.post(vec![serde_json::json!({
            "op": "span.end",
            "id": format!("{parent_span_id}:tool:{call_id}"),
            "ts": now_ms(),
            "status": if ok { "ok" } else { "error" },
        })]);
    }

    fn llm_usage(
        &self,
        session_id: &str,
        parent_span_id: &str,
        span_id: &str,
        model: &str,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        let ts = now_ms();
        self.post(vec![
            serde_json::json!({
                "op": "span.start",
                "id": span_id,
                "sessionId": session_id,
                "parentId": parent_span_id,
                "kind": "llm",
                "name": model,
                "ts": ts,
            }),
            serde_json::json!({
                "op": "span.end",
                "id": span_id,
                "ts": ts,
                "status": "ok",
                "attrs": {
                    "model": model,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                },
            }),
        ]);
    }

    fn message_finished(&self, _session_id: &str, span_id: &str, ok: bool) {
        self.post(vec![serde_json::json!({
            "op": "span.end",
            "id": span_id,
            "ts": now_ms(),
            "status": if ok { "ok" } else { "error" },
        })]);
    }

    fn session_ended(&self, session_id: &str) {
        self.post(vec![serde_json::json!({
            "op": "session.end",
            "sessionId": session_id,
            "ts": now_ms(),
        })]);
    }
}
