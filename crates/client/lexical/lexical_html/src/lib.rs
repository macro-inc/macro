//! Owned DOM export and linkedom-compatible HTML serialization, without browser APIs.
#![deny(missing_docs)]
pub mod css;
pub mod theme;
pub use theme::*;
pub mod dom;
pub mod js;
pub mod serialize;
pub use dom::*;
pub use serialize::*;
/// HTML export failures at model or registry boundaries.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A model read failed.
    #[error(transparent)]
    Model(#[from] lexical_model::Error),
    /// The selected node has no registered HTML exporter.
    #[error("unregistered HTML node type {type_name}")]
    UnregisteredNodeType {
        /// Registered model type name.
        type_name: String,
    },
    /// An export callback returned an invalid structure.
    #[error("invalid HTML export: {0}")]
    InvalidExport(&'static str),
}
/// Result of a portable HTML operation.
pub type Result<T> = std::result::Result<T, Error>;

pub mod export;
pub use export::*;
pub mod registry;
pub use registry::*;
pub mod config;
pub use config::*;
pub mod selection;
pub use selection::*;
pub mod nodes;
mod walk;
use lexical_model::{EditorState, NodeKey, Read, Selection};
/// Configured exporter over immutable model snapshots.
pub struct HtmlExporter<C: DomRenderConfig = DefaultDomRenderConfig> {
    /// Exact-type exporters and host overrides.
    pub registry: ExportRegistry,
    /// Theme classes; default is the empty headless theme.
    pub theme: EditorTheme,
    /// Host export policies.
    pub config: C,
}
impl HtmlExporter {
    /// Construct an exporter with default headless render policies.
    pub fn new(registry: ExportRegistry, theme: EditorTheme) -> Self {
        Self {
            registry,
            theme,
            config: DefaultDomRenderConfig,
        }
    }
}
impl<C: DomRenderConfig> HtmlExporter<C> {
    /// Generate container.innerHTML from the root's selected children.
    pub fn generate_html_from_nodes(
        &self,
        state: &EditorState,
        selection: Option<&Selection>,
    ) -> Result<String> {
        Ok(inner_html(&self.generate_dom_from_nodes(state, selection)?))
    }
    /// Generate owned output nodes without a browser DOM.
    pub fn generate_dom_from_nodes(
        &self,
        state: &EditorState,
        selection: Option<&Selection>,
    ) -> Result<Vec<HtmlNode>> {
        let ctx = ExportCtx {
            state,
            theme: &self.theme,
            selection,
        };
        let mut output = Vec::new();
        for key in state.children_keys(NodeKey::ROOT)? {
            walk::append_nodes_to_html(self, &ctx, key, &mut output)?;
        }
        Ok(output)
    }
}
