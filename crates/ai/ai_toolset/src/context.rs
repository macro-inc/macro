use crate::tool_search::{SearchableTool, ToolLoader};
use macro_user_id::user_id::MacroUserIdStr;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

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
}

impl RequestContext {
    /// Create a request context for `user_id` with no tool-search wiring (no
    /// searchable catalog, no loader).
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self {
            user_id,
            searchable_tools: Arc::new(Vec::new()),
            tool_loader: None,
            cancel: CancellationToken::new(),
            genai_telemetry: true,
        }
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
}
