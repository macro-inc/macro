//! The capabilities the service needs from the outside.
//!
//! Four, and the split is deliberate. [`SessionAuthority`] answers "may this
//! request happen at all", [`McpCredentials`] and [`GithubTokens`] answer
//! "with whose credential, to where" for the two kinds of upstream, and
//! [`Forwarder`] does the one thing that is genuinely transport work. Only the
//! last touches a socket, which is what lets the decisions above it be tested
//! exhaustively without one.

use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;

use crate::domain::approval::{ToolApproval, ToolApprovalId};
use crate::domain::error::EgressError;
use crate::domain::model::{
    AgentSessionId, McpDestination, McpResolution, ProxyRequest, ProxyResponse, RepoSlug,
    SessionGrant, SessionToken, UpstreamCall,
};
use macro_user_id::user_id::MacroUserIdStr;

/// Turn a sandbox's session token into what it is allowed to spend.
///
/// Implementations verify the token *and* confirm the session is still open:
/// closing a session is how a person revokes its egress, and a token that
/// outlived its session must stop working the moment the session ends rather
/// than when it expires.
pub trait SessionAuthority: Send + Sync {
    /// Verify `token`, or say why it does not entitle anyone to anything.
    fn authorize(
        &self,
        token: &SessionToken,
    ) -> impl Future<Output = Result<SessionGrant, EgressError>> + Send;
}

/// Resolve an MCP destination to a live upstream call.
///
/// Implementations own token freshness: a returned [`UpstreamCall`] carries a
/// credential good now, refreshing and persisting the owner's stored grant if
/// that is what it took. The service above deliberately knows nothing about
/// OAuth.
pub trait McpCredentials: Send + Sync {
    /// The upstream and credential for `destination`, on behalf of `owner`.
    ///
    /// Resolution is scoped to `owner`: a slug that names somebody else's
    /// server is never somebody else's server. [`McpResolution::Connected`]
    /// when the owner holds an enabled grant; [`McpResolution::Unconnected`]
    /// when they do not but the upstream can still be addressed for them
    /// (Pipedream scopes by user and app alone); [`EgressError::UnknownServer`]
    /// only when the destination cannot be addressed at all.
    fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> impl Future<Output = Result<McpResolution, EgressError>> + Send;
}

/// Mint a credential for git access to one repository.
///
/// Implementations own both the minting and the "may this owner touch this
/// repository at all" question, because only they can see the GitHub App's
/// installations. The returned [`UpstreamCall`] addresses the repository's git
/// base and must end in a `/` so the endpoint appends rather than replaces the
/// last segment; the service appends the endpoint, so an implementation cannot
/// widen what the sandbox reaches beyond the allowlist.
pub trait GithubTokens: Send + Sync {
    /// A credential for `repo`, valid because `owner` may reach it.
    ///
    /// Refusing with [`EgressError::RepoUnavailable`] is the answer when the
    /// App's installation for `repo` does not belong to `owner` or one of
    /// their teams. Without that check any session could be configured with any
    /// repository the App happens to be installed on and be handed write
    /// access to it.
    fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        repo: &RepoSlug,
    ) -> impl Future<Output = Result<UpstreamCall, EgressError>> + Send;
}

/// Execute a request and stream the answer back.
///
/// The only port that speaks to the network, and deliberately the dumbest:
/// by the time a request reaches here it is already addressed at its
/// upstream and stamped with the right credential, so an implementation has
/// no decision left to make. It sends what it is given and passes the status
/// and body back without interpreting either.
pub trait Forwarder: Send + Sync {
    /// Send `request` wherever its URI points, streaming both directions.
    fn forward(
        &self,
        request: ProxyRequest,
    ) -> impl Future<Output = Result<ProxyResponse, EgressError>> + Send;
}

/// Where held tool calls are recorded.
///
/// Every resolution is conditional on the row still being pending, which is
/// what makes the first resolution the only one: an owner's answer racing
/// the hold's own deadline on another replica cannot both land.
pub trait ToolApprovalStore: Send + Sync + 'static {
    /// Record a newly held call.
    fn insert(
        &self,
        approval: &ToolApproval,
    ) -> impl Future<Output = Result<(), EgressError>> + Send;

    /// Resolve `id` if it is still pending, and wake whoever waits on it.
    /// `None` when it was not pending or does not exist.
    fn resolve(
        &self,
        id: ToolApprovalId,
        status: ToolApprovalStatus,
        resolved_by: Option<&MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<Option<ToolApproval>, EgressError>> + Send;

    /// The approval `id`, whatever its state.
    fn get(
        &self,
        id: ToolApprovalId,
    ) -> impl Future<Output = Result<Option<ToolApproval>, EgressError>> + Send;

    /// The pending approval holding `session`'s JSON-RPC request `request_id`.
    fn pending_for_request(
        &self,
        session: AgentSessionId,
        request_id: &serde_json::Value,
    ) -> impl Future<Output = Result<Option<ToolApprovalId>, EgressError>> + Send;

    /// Every approval `session` has pending.
    fn pending_for_session(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Vec<ToolApprovalId>, EgressError>> + Send;
}

/// Wakes a hold when its approval may have been resolved, wherever that
/// happened.
pub trait ToolApprovalSignals: Send + Sync + 'static {
    /// A waiter on one approval.
    type Subscription: ToolApprovalSubscription;

    /// Start listening for `id`. Registered by the time this returns, so a
    /// resolution after it is never missed.
    fn subscribe(&self, id: ToolApprovalId) -> Self::Subscription;
}

/// A waiter on one approval.
pub trait ToolApprovalSubscription: Send + 'static {
    /// Resolves when the approval may have changed. Wakes can be spurious,
    /// and a waiter re-reads the store either way.
    fn changed(&mut self) -> impl Future<Output = ()> + Send;
}

/// Tells people about held calls: the session's viewers see each state in
/// its log, and the owner is notified when one starts waiting on them.
/// Best-effort; a failure is the adapter's to log.
pub trait ToolApprovalAnnouncer: Send + Sync + 'static {
    /// A call started waiting on `owner`.
    fn requested(
        &self,
        approval: &ToolApproval,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = ()> + Send;

    /// A held call was resolved.
    fn resolved(&self, approval: &ToolApproval) -> impl Future<Output = ()> + Send;
}
