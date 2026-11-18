//! Host overrides for the export half of EditorDOMRenderConfig.
use crate::*;
use lexical_model::*;
/// Policies used by the HTML walker; defaults match headless upstream export.
pub trait DomRenderConfig {
    /// Include whole documents, or the nodes selected by the supplied selection.
    fn should_include(&self, ctx: &ExportCtx<'_>, key: NodeKey) -> bool {
        ctx.selection
            .is_none_or(|selection| is_selected(ctx.state, key, selection))
    }
    /// Drop excluded element wrappers and hoist their children.
    fn should_exclude(
        &self,
        ctx: &ExportCtx<'_>,
        _registry: &ExportRegistry,
        key: NodeKey,
    ) -> bool {
        ctx.state.is_element(key)
            && ctx
                .state
                .exclude_from_copy(key, Some(CopyDestination::Html))
    }
    /// Promote a selected child into inclusion of its parent wrapper.
    fn extract_with_child(
        &self,
        ctx: &ExportCtx<'_>,
        _registry: &ExportRegistry,
        key: NodeKey,
        child: NodeKey,
        destination: CopyDestination,
    ) -> bool {
        ctx.state.is_element(key)
            && ctx
                .state
                .extract_with_child(key, child, ctx.selection, destination)
    }
    /// Select the host override or registered per-node exporter.
    fn export_dom<'a>(
        &self,
        ctx: &ExportCtx<'a>,
        registry: &ExportRegistry,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        registry.export(ctx, key)
    }
}
/// Headless export policies without host overrides.
pub struct DefaultDomRenderConfig;
impl DomRenderConfig for DefaultDomRenderConfig {}
