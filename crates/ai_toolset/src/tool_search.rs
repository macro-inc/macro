//! Primitives for custom (provider-agnostic) tool search.
//!
//! A toolset can mark some tools as **searchable** (loaded on demand) rather
//! than sent on every request. The catalog of those tools is exposed via
//! [`ToolSet::searchable_catalog`](crate::ToolSet::searchable_catalog). A
//! first-party `SearchTools` tool reads the catalog from the
//! [`RequestContext`](crate::RequestContext), matches the model's query, and
//! asks the [`ToolLoader`] to load the matches — the agent layer's loader makes
//! them real, callable tools on the next turn. This keeps a large/growing tool
//! catalog out of every request without depending on any provider's native
//! tool-search feature.

use schemars::Schema;
use std::sync::Arc;

/// A tool that is loaded on demand via tool search rather than sent on every
/// request. The catalog of these is returned by
/// [`ToolSet::searchable_catalog`](crate::ToolSet::searchable_catalog) and read
/// by the `SearchTools` tool to match the model's query.
#[derive(Clone, Debug)]
pub struct SearchableTool {
    /// The tool's name, exactly as it must be called (e.g. a mangled MCP name).
    pub name: String,
    /// Human-readable description, matched against search queries.
    pub description: String,
    /// JSON schema for the tool's input — needed to register the tool once it
    /// is loaded.
    pub schema: Schema,
}

/// Callback that loads searchable tools into the active request.
///
/// `SearchTools` calls this with the tools matching the query. The agent layer
/// supplies the implementation, which registers the tools with the live tool
/// server so they become advertised and callable on the next turn. Defined here
/// as a plain `Fn` so `ai_toolset` stays free of any agent/rig dependency.
#[derive(Clone)]
pub struct ToolLoader(Arc<dyn Fn(Vec<SearchableTool>) + Send + Sync>);

impl ToolLoader {
    /// Wrap a closure as a [`ToolLoader`].
    pub fn new(f: impl Fn(Vec<SearchableTool>) + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }

    /// Request that `tools` be loaded into the active request.
    pub fn load(&self, tools: Vec<SearchableTool>) {
        (self.0)(tools)
    }
}

impl std::fmt::Debug for ToolLoader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolLoader")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::RequestContext;
    use macro_user_id::user_id::MacroUserIdStr;
    use std::sync::Mutex;

    fn tool(name: &str) -> SearchableTool {
        SearchableTool {
            name: name.to_string(),
            description: String::new(),
            schema: Schema::default(),
        }
    }

    #[test]
    fn tool_loader_forwards_to_its_closure() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = seen.clone();
        let loader = ToolLoader::new(move |tools| {
            sink.lock()
                .unwrap()
                .extend(tools.into_iter().map(|t| t.name));
        });

        loader.load(vec![tool("a"), tool("b")]);

        assert_eq!(&*seen.lock().unwrap(), &["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn request_context_new_has_no_tool_search() {
        let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
        let ctx = RequestContext::new(user);
        assert!(ctx.searchable_tools.is_empty());
        assert!(ctx.tool_loader.is_none());
    }

    #[test]
    fn with_tool_search_wires_catalog_and_loader() {
        let user = MacroUserIdStr::try_from_email("t@example.com").unwrap();
        let catalog = Arc::new(vec![tool("mcp__x__y")]);
        let loader = ToolLoader::new(|_| {});
        let ctx = RequestContext::new(user).with_tool_search(catalog, loader);

        assert_eq!(ctx.searchable_tools.len(), 1);
        assert_eq!(ctx.searchable_tools[0].name, "mcp__x__y");
        assert!(ctx.tool_loader.is_some());
    }
}
