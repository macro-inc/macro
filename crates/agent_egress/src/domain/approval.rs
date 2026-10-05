//! Holding an MCP tool call until the session's owner approves it.
//!
//! A session spends its owner's credentials whoever prompts it. When somebody
//! else prompted the running turn, every `tools/call` it makes is held here:
//! recorded as a pending approval, announced where the session's viewers see
//! it (and to the owner as a notification), and answered only once the owner
//! approves, declines, someone with edit access cancels, or nobody answers in
//! time.
//!
//! The hold is an event stream on the call's own HTTP response. Its first
//! bytes go out at once, and a progress notification follows every
//! [`KEEPALIVE_EVERY`], which is what keeps an MCP client that resets its
//! request timeout on progress (opencode does) waiting for as long as the
//! owner takes. A client that sent no progress token gets comments instead,
//! and a shorter limit: nothing says it will wait longer than the transport
//! does.
//!
//! The approval row is the whole truth. Whoever resolves it - the owner's
//! answer on any replica, the hold's own deadline, the agent cancelling its
//! request, the turn ending - does so by updating a still-pending row, so
//! exactly one resolution wins, and the hold wakes on the store's signal to
//! read which.

use std::fmt;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::tool_approval::{ToolApprovalNotice, ToolApprovalStatus};
use bytes::Bytes;
use http::header::{CACHE_CONTROL, CONTENT_TYPE};
use http::{HeaderValue, StatusCode};
use http_body_util::{BodyExt, StreamBody};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use tokio::sync::mpsc;

use crate::domain::error::EgressError;
use crate::domain::model::{AgentSessionId, BoxError, ProxyRequest, ProxyResponse, TurnPrompter};
use crate::domain::ports::{
    ToolApprovalAnnouncer, ToolApprovalSignals, ToolApprovalStore, ToolApprovalSubscription,
};

#[cfg(test)]
mod test;

/// How often a held call's stream says it is still alive.
pub const KEEPALIVE_EVERY: Duration = Duration::from_secs(15);

/// How long a call is held for a client that resets its timeout on
/// progress, and in-process, where the turn counts the hold as waiting on a
/// person rather than as silence.
pub const HOLD_LIMIT_WITH_PROGRESS: Duration = Duration::from_secs(30 * 60);

/// How long a call is held for an MCP client that sent no progress token:
/// nothing says it will wait longer than a transport usually does.
pub const HOLD_LIMIT: Duration = Duration::from_secs(4 * 60);

/// The server slug Macro's own tools are held under.
pub const MACRO_SERVER_SLUG: &str = "macro";

/// Macro's tools that use nobody's access: looking things up on the public
/// web, and Macro's help about itself. Everything else on Macro's server
/// reads or changes the owner's own data, and every connected app is the
/// owner's own account.
const MACRO_TOOLS_WITHOUT_OWNER_ACCESS: [&str; 3] = ["WebSearch", "WebFetch", "SelfKnowledge"];

/// Whether calling `tool` on `server_slug` spends the owner's access, and so
/// waits for them in a turn somebody else prompted.
#[must_use]
pub fn spends_owner_access(server_slug: &str, tool: &str) -> bool {
    server_slug != MACRO_SERVER_SLUG || !MACRO_TOOLS_WITHOUT_OWNER_ACCESS.contains(&tool)
}

/// Identifies one held call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ToolApprovalId(Uuid);

impl ToolApprovalId {
    /// A fresh id, time-ordered.
    #[must_use]
    pub fn mint() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Wrap a stored id.
    #[must_use]
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id as stored.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for ToolApprovalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// One held call and where it stands.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolApproval {
    /// Its id.
    pub id: ToolApprovalId,
    /// The session whose agent made the call.
    pub session: AgentSessionId,
    /// The turn it was made in.
    pub turn_action_id: AgentActionId,
    /// The call's JSON-RPC id.
    pub request_id: serde_json::Value,
    /// The owner whose access the call spends; the only one who may approve
    /// or decline it.
    pub owner: MacroUserIdStr<'static>,
    /// Who prompted the turn; `None` for a bot on nobody's behalf.
    pub requested_by: Option<MacroUserIdStr<'static>>,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server.
    pub server_name: String,
    /// The tool called.
    pub tool_name: String,
    /// What it was called with.
    pub arguments: serde_json::Value,
    /// Where it stands.
    pub status: ToolApprovalStatus,
    /// Who resolved it, when a person did.
    pub resolved_by: Option<MacroUserIdStr<'static>>,
}

impl ToolApproval {
    /// The frame the session's log records for this state.
    #[must_use]
    pub fn notice(&self) -> ToolApprovalNotice {
        ToolApprovalNotice {
            approval_id: self.id.to_string(),
            server_slug: self.server_slug.clone(),
            server_name: self.server_name.clone(),
            tool_name: self.tool_name.clone(),
            arguments: self.arguments.clone(),
            requested_by: self
                .requested_by
                .as_ref()
                .map(|user| user.as_ref().to_owned()),
            status: self.status,
            resolved_by: self
                .resolved_by
                .as_ref()
                .map(|user| user.as_ref().to_owned()),
        }
    }
}

/// What a person answers a held call with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalAnswer {
    /// Let it run.
    Approve,
    /// Refuse it.
    Deny,
    /// Give up waiting on the owner.
    Cancel,
}

impl ApprovalAnswer {
    fn status(self) -> ToolApprovalStatus {
        match self {
            Self::Approve => ToolApprovalStatus::Approved,
            Self::Deny => ToolApprovalStatus::Denied,
            Self::Cancel => ToolApprovalStatus::Cancelled,
        }
    }
}

/// Why an answer was refused.
#[derive(Debug, thiserror::Error)]
pub enum ToolApprovalError {
    /// No such approval in this session.
    #[error("no such tool approval")]
    NotFound,
    /// Somebody resolved it first.
    #[error("the tool approval was already resolved")]
    NotPending,
    /// Only the owner may approve or decline.
    #[error("only the session owner may approve or decline a tool call")]
    NotOwner,
    /// The store failed.
    #[error(transparent)]
    Egress(#[from] EgressError),
}

/// The parts of a `tools/call` the hold reads.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolsCall {
    /// The JSON-RPC id the answer echoes.
    pub id: serde_json::Value,
    /// The tool's name.
    pub name: String,
    /// Its arguments.
    pub arguments: serde_json::Value,
    /// The progress token the client asked to be kept alive under.
    pub progress_token: Option<serde_json::Value>,
}

impl ToolsCall {
    /// Read a `tools/call` request body; `None` for anything else.
    #[must_use]
    pub fn parse(body: &[u8]) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_slice(body).ok()?;
        if value.get("method")?.as_str()? != crate::domain::model::TOOLS_CALL_METHOD {
            return None;
        }
        let id = value.get("id").filter(|id| !id.is_null())?.clone();
        let params = value.get("params")?;
        Some(Self {
            id,
            name: params.get("name")?.as_str()?.to_owned(),
            arguments: params
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            progress_token: params
                .get("_meta")
                .and_then(|meta| meta.get("progressToken"))
                .filter(|token| !token.is_null())
                .cloned(),
        })
    }
}

/// Sends an approved call upstream. Built by the proxy over its own
/// forwarder, so the hold never learns how.
pub type ForwardOnce = Box<
    dyn FnOnce(
            ProxyRequest,
        ) -> Pin<Box<dyn Future<Output = Result<ProxyResponse, EgressError>> + Send>>
        + Send,
>;

/// A `tools/call` the proxy is holding, with everything it takes to put it
/// through once approved.
pub struct HeldCall {
    /// The session whose agent made it.
    pub session: AgentSessionId,
    /// The owner whose approval it waits on.
    pub owner: MacroUserIdStr<'static>,
    /// Who prompted the turn it was made in.
    pub prompter: TurnPrompter,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server.
    pub server_name: String,
    /// The call.
    pub call: ToolsCall,
    /// The request, already addressed and stamped for the upstream.
    pub request: ProxyRequest,
    /// How to send it.
    pub forward: ForwardOnce,
}

/// Holds calls for the owner's approval.
pub trait OwnerApprovals: Send + Sync + 'static {
    /// Answer `call`: at once with a stream that ends in the call's own
    /// result once it is approved, or in a result saying why it did not run.
    fn hold(
        &self,
        call: HeldCall,
    ) -> impl Future<Output = Result<ProxyResponse, EgressError>> + Send;

    /// The agent withdrew its request `request_id` (`notifications/cancelled`):
    /// stop holding it, if it is held.
    fn withdraw(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> impl Future<Output = Result<(), EgressError>> + Send;
}

impl<Approvals: OwnerApprovals> OwnerApprovals for Arc<Approvals> {
    fn hold(
        &self,
        call: HeldCall,
    ) -> impl Future<Output = Result<ProxyResponse, EgressError>> + Send {
        (**self).hold(call)
    }

    fn withdraw(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> impl Future<Output = Result<(), EgressError>> + Send {
        (**self).withdraw(session, request_id)
    }
}

/// For a proxy with no way to ask the owner: every held call is refused, in
/// words the model can relay. Fails closed, so a deployment that forgot to
/// wire approvals cannot spend the owner's access on somebody else's behalf.
#[derive(Clone, Copy, Debug, Default)]
pub struct RefuseHeldCalls;

impl OwnerApprovals for RefuseHeldCalls {
    async fn hold(&self, call: HeldCall) -> Result<ProxyResponse, EgressError> {
        let text = format!(
            "{tool} did not run. Someone other than {owner}, whose access this session uses, \
             prompted this turn, and tool calls in such a turn need {owner} to approve them, \
             which is not possible here. Tell the person who asked, and do not try to do the \
             same thing another way.",
            tool = call.call.name,
            owner = call.owner.email_str(),
        );
        Ok(json_response(&tool_error(&call.call.id, &text)))
    }

    async fn withdraw(
        &self,
        _session: AgentSessionId,
        _request_id: &serde_json::Value,
    ) -> Result<(), EgressError> {
        Ok(())
    }
}

/// The approval flow over its store, its wake-ups, and whoever it announces
/// to. Cheap to clone; clones share everything.
pub struct ToolApprovalService<Store, Signals, Announcer> {
    inner: Arc<Inner<Store, Signals, Announcer>>,
}

impl<Store, Signals, Announcer> Clone for ToolApprovalService<Store, Signals, Announcer> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct Inner<Store, Signals, Announcer> {
    store: Store,
    signals: Signals,
    announcer: Announcer,
    timing: HoldTiming,
}

/// How long a hold lasts and how often it speaks. Constants in production;
/// shortened in tests.
#[derive(Clone, Copy, Debug)]
pub struct HoldTiming {
    /// See [`KEEPALIVE_EVERY`].
    pub keepalive_every: Duration,
    /// See [`HOLD_LIMIT_WITH_PROGRESS`].
    pub limit_with_progress: Duration,
    /// See [`HOLD_LIMIT`].
    pub limit: Duration,
}

impl Default for HoldTiming {
    fn default() -> Self {
        Self {
            keepalive_every: KEEPALIVE_EVERY,
            limit_with_progress: HOLD_LIMIT_WITH_PROGRESS,
            limit: HOLD_LIMIT,
        }
    }
}

impl<Store, Signals, Announcer> ToolApprovalService<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    /// Build the flow over its adapters.
    pub fn new(store: Store, signals: Signals, announcer: Announcer) -> Self {
        Self::with_timing(store, signals, announcer, HoldTiming::default())
    }

    /// [`Self::new`], holding for other durations.
    pub fn with_timing(
        store: Store,
        signals: Signals,
        announcer: Announcer,
        timing: HoldTiming,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                store,
                signals,
                announcer,
                timing,
            }),
        }
    }
}

/// A tool call made in-process - the in-memory runtime's own Macro tools -
/// with nothing to stream a hold into.
#[derive(Clone, Debug)]
pub struct InProcessCall {
    /// The session whose agent made it.
    pub session: AgentSessionId,
    /// The owner whose approval it waits on.
    pub owner: MacroUserIdStr<'static>,
    /// Who prompted the turn it was made in.
    pub prompter: TurnPrompter,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server.
    pub server_name: String,
    /// The tool called.
    pub tool_name: String,
    /// What it was called with.
    pub arguments: serde_json::Value,
}

impl<Store, Signals, Announcer> ToolApprovalService<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    /// Hold `call` until it is resolved, and say how. Dropping the future
    /// cancels the hold, which is how a stopped turn gives up on it.
    pub async fn hold_in_process(&self, call: InProcessCall) -> Result<ToolApproval, EgressError> {
        let approval = ToolApproval {
            id: ToolApprovalId::mint(),
            session: call.session,
            turn_action_id: call.prompter.action_id,
            // No JSON-RPC request to name; unique so nothing withdraws it.
            request_id: serde_json::Value::String(macro_uuid::generate_uuid_v7().to_string()),
            owner: call.owner.clone(),
            requested_by: call.prompter.user.clone(),
            server_slug: call.server_slug,
            server_name: call.server_name,
            tool_name: call.tool_name,
            arguments: call.arguments,
            status: ToolApprovalStatus::Pending,
            resolved_by: None,
        };
        self.inner.store.insert(&approval).await?;
        tracing::info!(
            approval = %approval.id,
            session = %approval.session,
            tool = %approval.tool_name,
            "holding an in-process tool call for the owner's approval"
        );
        self.inner.announcer.requested(&approval, &call.owner).await;

        let guard = CancelOnDrop {
            inner: Some(Arc::clone(&self.inner)),
            id: approval.id,
        };
        let resolved = self
            .inner
            .await_resolution(&approval, None, call.owner.email_str(), None)
            .await;
        guard.disarm();
        resolved
    }
}

/// Cancels a held call whose waiter went away before it was resolved.
struct CancelOnDrop<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    inner: Option<Arc<Inner<Store, Signals, Announcer>>>,
    id: ToolApprovalId,
}

impl<Store, Signals, Announcer> CancelOnDrop<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    fn disarm(mut self) {
        self.inner = None;
    }
}

impl<Store, Signals, Announcer> Drop for CancelOnDrop<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    fn drop(&mut self) {
        if let Some(inner) = self.inner.take() {
            let id = self.id;
            tokio::spawn(async move {
                if let Err(error) = inner.resolve(id, ToolApprovalStatus::Cancelled, None).await {
                    tracing::warn!(error = ?error, approval = %id, "could not cancel an abandoned tool call");
                }
            });
        }
    }
}

/// Answering held calls: what the session view's buttons reach.
pub trait ToolApprovalAnswers: Send + Sync + 'static {
    /// A person's answer to the held call `id` in `session`. The caller has
    /// already checked `by` may edit the session.
    ///
    /// Only the owner recorded on the approval approves or declines: the
    /// call spends their access. Anyone with edit access may cancel, which is
    /// how a turn gets unstuck while the owner is away.
    fn answer(
        &self,
        session: AgentSessionId,
        id: ToolApprovalId,
        answer: ApprovalAnswer,
        by: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ToolApproval, ToolApprovalError>> + Send;

    /// Stop holding every call `session` is waiting on: its turn ended, it
    /// stopped, or it is being deleted.
    fn release_session(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), EgressError>> + Send;
}

impl<Answers: ToolApprovalAnswers> ToolApprovalAnswers for Arc<Answers> {
    fn answer(
        &self,
        session: AgentSessionId,
        id: ToolApprovalId,
        answer: ApprovalAnswer,
        by: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<ToolApproval, ToolApprovalError>> + Send {
        (**self).answer(session, id, answer, by)
    }

    fn release_session(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<(), EgressError>> + Send {
        (**self).release_session(session)
    }
}

impl<Store, Signals, Announcer> ToolApprovalAnswers
    for ToolApprovalService<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    async fn answer(
        &self,
        session: AgentSessionId,
        id: ToolApprovalId,
        answer: ApprovalAnswer,
        by: &MacroUserIdStr<'static>,
    ) -> Result<ToolApproval, ToolApprovalError> {
        let approval = self
            .inner
            .store
            .get(id)
            .await?
            .filter(|approval| approval.session == session)
            .ok_or(ToolApprovalError::NotFound)?;
        if answer != ApprovalAnswer::Cancel && *by != approval.owner {
            return Err(ToolApprovalError::NotOwner);
        }
        if !approval.status.is_pending() {
            return Err(ToolApprovalError::NotPending);
        }
        self.inner
            .resolve(id, answer.status(), Some(by))
            .await?
            .ok_or(ToolApprovalError::NotPending)
    }

    async fn release_session(&self, session: AgentSessionId) -> Result<(), EgressError> {
        for id in self.inner.store.pending_for_session(session).await? {
            self.inner
                .resolve(id, ToolApprovalStatus::Cancelled, None)
                .await?;
        }
        Ok(())
    }
}

impl<Store, Signals, Announcer> Inner<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    /// Resolve `id` if it is still pending, and announce the resolution.
    /// `None` when somebody else resolved it first.
    async fn resolve(
        &self,
        id: ToolApprovalId,
        status: ToolApprovalStatus,
        by: Option<&MacroUserIdStr<'static>>,
    ) -> Result<Option<ToolApproval>, EgressError> {
        let resolved = self.store.resolve(id, status, by).await?;
        if let Some(approval) = &resolved {
            tracing::info!(
                approval = %approval.id,
                session = %approval.session,
                status = approval.status.as_str(),
                "resolved a held tool call"
            );
            self.announcer.resolved(approval).await;
        }
        Ok(resolved)
    }

    /// Wait until `id` is no longer pending, keeping the client alive on
    /// `keepalive`, and resolve it as expired at the limit or cancelled when
    /// the client goes away first. The approval as it was resolved.
    async fn await_resolution(
        &self,
        approval: &ToolApproval,
        progress_token: Option<&serde_json::Value>,
        owner: &str,
        events: Option<&mpsc::Sender<Bytes>>,
    ) -> Result<ToolApproval, EgressError> {
        let mut subscription = self.signals.subscribe(approval.id);
        let limit = if progress_token.is_some() || events.is_none() {
            self.timing.limit_with_progress
        } else {
            self.timing.limit
        };
        let deadline = tokio::time::Instant::now() + limit;
        let mut ticks = 0_u64;
        loop {
            // Read after subscribing, so a resolution between the two is
            // seen here rather than missed.
            let Some(current) = self.store.get(approval.id).await? else {
                // Deleted with its session: nobody is left to answer.
                return Ok(ToolApproval {
                    status: ToolApprovalStatus::Cancelled,
                    ..approval.clone()
                });
            };
            if !current.status.is_pending() {
                return Ok(current);
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                if let Some(expired) = self
                    .resolve(approval.id, ToolApprovalStatus::Expired, None)
                    .await?
                {
                    return Ok(expired);
                }
                continue;
            }
            let tick = (now + self.timing.keepalive_every).min(deadline);
            let closed = async {
                match events {
                    Some(events) => events.closed().await,
                    // An in-process caller stops waiting by dropping the
                    // future, which its own guard answers.
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                () = subscription.changed() => {}
                () = closed => {
                    tracing::info!(approval = %approval.id, "the client stopped waiting on a held tool call");
                    if let Some(cancelled) = self
                        .resolve(approval.id, ToolApprovalStatus::Cancelled, None)
                        .await?
                    {
                        return Ok(cancelled);
                    }
                }
                () = tokio::time::sleep_until(tick) => {
                    let Some(events) = events else {
                        continue;
                    };
                    ticks += 1;
                    let keepalive = match progress_token {
                        Some(token) => sse_message(&serde_json::json!({
                            "jsonrpc": "2.0",
                            "method": "notifications/progress",
                            "params": {
                                "progressToken": token,
                                "progress": ticks,
                                "message": format!("Waiting for {owner} to approve {}", approval.tool_name),
                            },
                        })),
                        None => Bytes::from_static(b": waiting for the session owner\n\n"),
                    };
                    // A closed stream is noticed on the next pass.
                    let _ = events.send(keepalive).await;
                }
            }
        }
    }

    /// The whole hold, run beside the response it streams into.
    async fn run_hold(
        self: Arc<Self>,
        call: HeldCall,
        approval: ToolApproval,
        events: mpsc::Sender<Bytes>,
    ) {
        let owner = call.owner.email_str().to_owned();
        let tool = approval.tool_name.clone();
        let id = call.call.id.clone();
        let resolved = match self
            .await_resolution(
                &approval,
                call.call.progress_token.as_ref(),
                &owner,
                Some(&events),
            )
            .await
        {
            Ok(resolved) => resolved,
            Err(error) => {
                tracing::error!(error = ?error, approval = %approval.id, "a held tool call could not be resolved");
                let text = format!(
                    "{tool} did not run: waiting for {owner} to approve it failed. Tell the person \
                     who asked, and do not try to do the same thing another way."
                );
                let _ = events.send(sse_message(&tool_error(&id, &text))).await;
                return;
            }
        };

        match refusal(resolved.status, &owner, &tool) {
            None => {
                pass_through(
                    call.forward,
                    call.request,
                    &id,
                    &approval.server_name,
                    &events,
                )
                .await;
            }
            Some(text) => {
                let _ = events.send(sse_message(&tool_error(&id, &text))).await;
            }
        }
    }
}

impl<Store, Signals, Announcer> OwnerApprovals for ToolApprovalService<Store, Signals, Announcer>
where
    Store: ToolApprovalStore,
    Signals: ToolApprovalSignals,
    Announcer: ToolApprovalAnnouncer,
{
    async fn hold(&self, call: HeldCall) -> Result<ProxyResponse, EgressError> {
        let approval = ToolApproval {
            id: ToolApprovalId::mint(),
            session: call.session,
            turn_action_id: call.prompter.action_id,
            request_id: call.call.id.clone(),
            owner: call.owner.clone(),
            requested_by: call.prompter.user.clone(),
            server_slug: call.server_slug.clone(),
            server_name: call.server_name.clone(),
            tool_name: call.call.name.clone(),
            arguments: call.call.arguments.clone(),
            status: ToolApprovalStatus::Pending,
            resolved_by: None,
        };
        self.inner.store.insert(&approval).await?;
        tracing::info!(
            approval = %approval.id,
            session = %approval.session,
            tool = %approval.tool_name,
            server = %approval.server_slug,
            "holding a tool call for the owner's approval"
        );
        self.inner.announcer.requested(&approval, &call.owner).await;

        let (events, received) = mpsc::channel::<Bytes>(8);
        // Something goes out at once: a client that sees headers and no
        // bytes may give up before the first keepalive.
        let _ = events
            .send(Bytes::from_static(b": waiting for the session owner\n\n"))
            .await;
        tokio::spawn(Arc::clone(&self.inner).run_hold(call, approval, events));
        Ok(stream_response(received))
    }

    async fn withdraw(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> Result<(), EgressError> {
        if let Some(id) = self
            .inner
            .store
            .pending_for_request(session, request_id)
            .await?
        {
            self.inner
                .resolve(id, ToolApprovalStatus::Cancelled, None)
                .await?;
        }
        Ok(())
    }
}

/// What the model is told instead of the tool's answer, for every outcome
/// but approval. The wording is ours, plus the owner's email and the tool's
/// name.
#[must_use]
pub fn refusal(status: ToolApprovalStatus, owner: &str, tool: &str) -> Option<String> {
    match status {
        ToolApprovalStatus::Approved => None,
        ToolApprovalStatus::Denied => Some(format!(
            "{owner} declined this call, so {tool} did not run. Tell the person who asked \
             that {owner} declined it, and do not try to do the same thing another way."
        )),
        ToolApprovalStatus::Cancelled => Some(format!(
            "This call was cancelled before {owner} approved it, so {tool} did not run. \
             Tell the person who asked, and do not try to do the same thing another way."
        )),
        ToolApprovalStatus::Expired | ToolApprovalStatus::Pending => Some(format!(
            "{owner} did not approve this call in time, so {tool} did not run. Tell the \
             person who asked that it needs {owner} to approve it, and stop."
        )),
    }
}

/// Send the approved call upstream and relay its answer into the stream.
async fn pass_through(
    forward: ForwardOnce,
    request: ProxyRequest,
    id: &serde_json::Value,
    server_name: &str,
    events: &mpsc::Sender<Bytes>,
) {
    let response = match forward(request).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = ?error, "an approved tool call could not reach its upstream");
            let text = format!("The call was approved, but {server_name} could not be reached.");
            let _ = events.send(sse_message(&tool_error(id, &text))).await;
            return;
        }
    };
    if !response.status().is_success() {
        let text = format!(
            "The call was approved, but {server_name} answered with HTTP {}.",
            response.status().as_u16()
        );
        let _ = events.send(sse_message(&tool_error(id, &text))).await;
        return;
    }
    let is_event_stream = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    let mut body = response.into_body();
    if is_event_stream {
        // Already events: relay them as they come.
        while let Some(frame) = body.frame().await {
            match frame {
                Ok(frame) => {
                    if let Ok(data) = frame.into_data()
                        && events.send(data).await.is_err()
                    {
                        return;
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "an approved tool call's stream broke");
                    return;
                }
            }
        }
        return;
    }
    let bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(error) => {
            tracing::warn!(error = %error, "an approved tool call's answer could not be read");
            return;
        }
    };
    let message = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(message) => sse_message(&message),
        Err(_) => sse_message(&tool_error(
            id,
            &format!(
                "The call was approved, but {server_name} answered with something that is not JSON."
            ),
        )),
    };
    let _ = events.send(message).await;
}

/// A tool result the model reads as the tool's own failed answer.
fn tool_error(id: &serde_json::Value, text: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "isError": true,
            "content": [{ "type": "text", "text": text }],
        },
    })
}

/// One JSON-RPC message as a server-sent event.
fn sse_message(message: &serde_json::Value) -> Bytes {
    let mut event = b"event: message\ndata: ".to_vec();
    event.extend(serde_json::to_vec(message).expect("a JSON value serializes"));
    event.extend(b"\n\n");
    Bytes::from(event)
}

fn json_response(message: &serde_json::Value) -> ProxyResponse {
    let bytes = Bytes::from(serde_json::to_vec(message).expect("a JSON value serializes"));
    let mut response = http::Response::new(
        http_body_util::Full::new(bytes)
            .map_err(|never| match never {})
            .boxed_unsync(),
    );
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn stream_response(received: mpsc::Receiver<Bytes>) -> ProxyResponse {
    let frames = futures::stream::unfold(received, |mut received| async move {
        received
            .recv()
            .await
            .map(|bytes| (Ok::<_, BoxError>(http_body::Frame::data(bytes)), received))
    });
    let mut response = http::Response::new(StreamBody::new(frames).boxed_unsync());
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}
