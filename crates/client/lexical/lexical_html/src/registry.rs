//! Exact node-type exporters and optional host overrides.
use crate::*;
use lexical_model::*;
use std::collections::HashMap;
/// Export functions keyed by the exact registered model type.
#[derive(Default)]
pub struct ExportRegistry {
    entries: HashMap<&'static str, ExportFn>,
    overrides: HashMap<&'static str, ExportFn>,
}
/// Builder for an immutable export registry.
#[derive(Default)]
pub struct ExportRegistryBuilder {
    registry: ExportRegistry,
}
impl ExportRegistry {
    /// Start an empty registry builder.
    pub fn builder() -> ExportRegistryBuilder {
        ExportRegistryBuilder::default()
    }
    /// Whether an exact type has an export implementation.
    pub fn contains(&self, type_name: &str) -> bool {
        self.entries.contains_key(type_name) || self.overrides.contains_key(type_name)
    }
    /// Invoke a host override or the registered node implementation.
    pub fn export<'a>(
        &self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        let type_name = ctx.state.type_name(key)?;
        let export = self
            .overrides
            .get(type_name)
            .or_else(|| self.entries.get(type_name))
            .ok_or(crate::Error::UnregisteredNodeType {
                type_name: type_name.to_owned(),
            })?;
        export(ctx, key)
    }
}
impl ExportRegistryBuilder {
    /// Register this exact node type.
    pub fn node<T: ExportDom>(mut self) -> Self {
        fn export<'a, T: ExportDom>(
            ctx: &ExportCtx<'a>,
            key: NodeKey,
        ) -> crate::Result<DomExportOutput<'a>> {
            let node = ctx
                .state
                .view()
                .get::<T>(key)
                .ok_or(lexical_model::Error::NodeTypeMismatch(key))?;
            node.export_dom(ctx, key)
        }
        self.registry.entries.insert(T::TYPE, export::<T>);
        self
    }
    /// Replace exportDOM for an exact registered type.
    pub fn override_export(mut self, node_type: &'static str, export: ExportFn) -> Self {
        self.registry.overrides.insert(node_type, export);
        self
    }
    /// Finish the registry.
    pub fn build(self) -> ExportRegistry {
        self.registry
    }
}
/// Register the four exportable core node types; root is traversed but never exported.
pub fn register_core(builder: ExportRegistryBuilder) -> ExportRegistryBuilder {
    builder
        .node::<Paragraph>()
        .node::<Text>()
        .node::<Tab>()
        .node::<LineBreak>()
}
