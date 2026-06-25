use crate::tool_search::{SearchableTool, ToolLoader};
use macro_user_id::user_id::MacroUserIdStr;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

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
}

impl RequestContext {
    /// Create a request context for `user_id` with no tool-search wiring (no
    /// searchable catalog, no loader).
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self {
            user_id,
            searchable_tools: Arc::new(Vec::new()),
            tool_loader: None,
        }
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
