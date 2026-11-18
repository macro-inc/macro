use crate::tool_search::{SearchableTool, ToolLoader, ToolMatch};
use macro_user_id::user_id::MacroUserIdStr;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Service context wrapper for shared state passed to tools.
///
/// This is provides access to
/// shared application state like database connections and API clients.
#[derive(Default, Debug, Clone, Copy)]
pub struct ServiceContext<S>(pub S);

impl<S> Deref for ServiceContext<S> {
    type Target = S;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<S> DerefMut for ServiceContext<S> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// Request context passed into tool calls, containing per-request data like user identity.
#[derive(Clone, Debug)]
pub struct RequestContext {
    /// The ID of the user making the request.
    pub user_id: MacroUserIdStr<'static>,
    /// Catalog of on-demand (searchable) tools for this request, read by the
    /// `SearchTools` tool to match the model's query. Empty when the request has
    /// no searchable tools.
    pub searchable_tools: Arc<Vec<SearchableTool>>,
    /// The tools sent with every request, so `SearchTools` can say a match is
    /// already callable instead of reporting nothing. Empty when the request
    /// has no tool search.
    pub advertised_tools: Arc<Vec<ToolMatch>>,
    /// Loader used by `SearchTools` to load matched tools into the active
    /// request. `None` when tool search is not wired up (e.g. non-agent callers).
    pub tool_loader: Option<ToolLoader>,
    /// user has requested stream stop
    /// long-running tools should comsume this
    pub cancel: CancellationToken,
    /// Whether tool calls in this request record `execute_tool` GenAI
    /// telemetry (arguments, result, failure) on their span. On by default;
    /// off when another layer already reports the request's tool calls - the
    /// agent session actor does, for the in-process runtime - so each call is
    /// counted once.
    pub genai_telemetry: bool,
    /// The approval this call carries, if any (see [`UserApproval`]); the
    /// model's arguments never set it.
    approval: Option<UserApproval>,
}

/// The approval a tool call carries. [`ApprovalKind::Reviewed`] is a person's:
/// only this crate makes it, when a user tool is finished after review
/// ([`crate::AsyncToolCollection::try_user_tool_call`]).
/// [`ApprovalKind::Quoted`] is the model's claim: any caller makes it from a
/// non-blank quote ([`RequestContext::with_quoted_confirmation`]), and nothing
/// checks the quote against what the user said.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UserApproval(ApprovalKind);

/// The kinds of [`UserApproval`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalKind {
    /// The user accepted the call on a review card or in a composer.
    Reviewed,
    /// The call quotes what it says is the user's reply approving it: only as
    /// strong as the model's honesty, like a send's `userConfirmation`.
    Quoted,
}

impl UserApproval {
    /// A user tool call the user reviewed and accepted.
    pub(crate) fn reviewed() -> Self {
        Self(ApprovalKind::Reviewed)
    }

    /// How the user approved the call.
    #[must_use]
    pub fn kind(self) -> ApprovalKind {
        self.0
    }
}

impl RequestContext {
    /// Create a request context for `user_id` with no tool-search wiring (no
    /// searchable catalog, no loader).
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self {
            user_id,
            searchable_tools: Arc::new(Vec::new()),
            advertised_tools: Arc::new(Vec::new()),
            tool_loader: None,
            cancel: CancellationToken::new(),
            genai_telemetry: true,
            approval: None,
        }
    }

    /// This request, for a user tool the user reviewed and accepted.
    pub(crate) fn reviewed(self) -> Self {
        Self {
            approval: Some(UserApproval::reviewed()),
            ..self
        }
    }

    /// The user's approval of this call, when they gave one.
    #[must_use]
    pub fn approval(&self) -> Option<UserApproval> {
        self.approval
    }

    /// This request, for a call quoting `quote`, the user's reply approving
    /// it. A blank quote approves nothing.
    #[must_use]
    pub fn with_quoted_confirmation(self, quote: &str) -> Option<Self> {
        (!quote.trim().is_empty()).then_some(Self {
            approval: Some(UserApproval(ApprovalKind::Quoted)),
            ..self
        })
    }

    /// Turn `execute_tool` GenAI telemetry for this request's tool calls on or
    /// off (see [`Self::genai_telemetry`]).
    pub fn with_genai_telemetry(mut self, enabled: bool) -> Self {
        self.genai_telemetry = enabled;
        self
    }

    /// Attach the searchable-tool catalog and loader that power `SearchTools`.
    pub fn with_tool_search(
        mut self,
        searchable_tools: Arc<Vec<SearchableTool>>,
        tool_loader: ToolLoader,
    ) -> Self {
        self.searchable_tools = searchable_tools;
        self.tool_loader = Some(tool_loader);
        self
    }

    /// Attach the tools sent with every request (see [`Self::advertised_tools`]).
    pub fn with_advertised_tools(mut self, advertised_tools: Arc<Vec<ToolMatch>>) -> Self {
        self.advertised_tools = advertised_tools;
        self
    }
}
