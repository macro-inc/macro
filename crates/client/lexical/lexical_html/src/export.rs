//! Per-type export contracts with optional append and after callbacks.
use crate::*;
use lexical_model::*;
/// Shared state and view configuration for one export traversal.
pub struct ExportCtx<'a> {
    /// Immutable model snapshot.
    pub state: &'a EditorState,
    /// Headless or host-supplied theme.
    pub theme: &'a EditorTheme,
    /// Optional selection to export.
    pub selection: Option<&'a Selection>,
}
impl ExportCtx<'_> {
    /// Selected text for the current text node, or its full stored content.
    pub fn text(&self, key: NodeKey) -> &str {
        self.state
            .view()
            .text(key)
            .map_or("", |data| data.text.as_str())
    }
}
/// Run after appending the node; callbacks may replace or remove it among siblings.
pub type AfterFn<'a> =
    Box<dyn FnOnce(&ExportCtx<'a>, &mut Vec<HtmlNode>, usize) -> crate::Result<()> + 'a>;
/// Append a children fragment at a node-specific location.
pub type AppendFn<'a> = Box<dyn FnOnce(&mut HtmlNode, Vec<HtmlNode>) + 'a>;
/// Output of one node's exportDOM implementation.
pub struct DomExportOutput<'a> {
    /// None skips the entire subtree.
    pub element: Option<HtmlNode>,
    /// Post-append structural adjustment.
    pub after: Option<AfterFn<'a>>,
    /// Custom child insertion callback.
    pub append: Option<AppendFn<'a>>,
    /// Override the model child list.
    pub children: Option<Vec<NodeKey>>,
}
impl DomExportOutput<'_> {
    /// Export an element with default child insertion.
    pub fn element(element: HtmlElement) -> Self {
        Self {
            element: Some(HtmlNode::Element(element)),
            after: None,
            append: None,
            children: None,
        }
    }
    /// Skip a node and all its descendants.
    pub fn skip() -> Self {
        Self {
            element: None,
            after: None,
            append: None,
            children: None,
        }
    }
    /// Export a fragment or text node with default child insertion.
    pub fn node(element: HtmlNode) -> Self {
        Self {
            element: Some(element),
            after: None,
            append: None,
            children: None,
        }
    }
}
/// Implement next to each model type; the registry stores monomorphized thunks.
pub trait ExportDom: NodeType {
    /// Build the node's output, with base fields read from the context snapshot.
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>>;
}
/// Type-erased registry or host override function.
pub type ExportFn = for<'a> fn(&ExportCtx<'a>, NodeKey) -> crate::Result<DomExportOutput<'a>>;
