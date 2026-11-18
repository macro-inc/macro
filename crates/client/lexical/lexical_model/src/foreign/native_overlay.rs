//! Runtime virtual methods on exact native registrations retain typed payloads.
use crate::*;
use std::sync::Arc;

pub(crate) struct NativeOverlay {
    pub baseline: NodeVTable,
    pub hooks: Arc<dyn ForeignHooks>,
}
pub(crate) fn supported(hook: ForeignHook) -> bool {
    !matches!(
        hook,
        ForeignHook::Import
            | ForeignHook::UpdateFromJson
            | ForeignHook::AdjustExportJson
            | ForeignHook::AfterClone
            | ForeignHook::StaticTransform
    )
}
impl EditorBuilder {
    /// Overlay native virtual methods without replacing the type or its payload.
    /// Import/update/export/clone lifecycle and static transforms remain separate.
    pub fn foreign_native_hooks(
        mut self,
        type_name: impl Into<String>,
        hooks: Arc<dyn ForeignHooks>,
    ) -> Self {
        self.native_overlays.push((type_name.into(), hooks));
        self
    }
}
pub(crate) fn install(
    registry: &mut Registry,
    registrations: Vec<(String, Arc<dyn ForeignHooks>)>,
) -> Result<(), BuildError> {
    for (type_name, hooks) in registrations {
        let invalid = || BuildError::InvalidNativeOverlay {
            type_name: type_name.clone(),
        };
        let index = registry.get(&type_name).ok_or_else(invalid)?.index;
        if registry.registered(index).foreign.is_some()
            || registry.native_overlays.contains_key(&index)
        {
            return Err(invalid());
        }
        let baseline = registry.vtable(index).clone();
        let table = &mut registry.vtables[usize::from(index.get())];
        super::dispatch::install_methods(table);
        // Export object/lifecycle callbacks require their own exact protocols.
        table.adjust_export_json = baseline.adjust_export_json;
        table.per_instance = true;
        registry
            .native_overlays
            .insert(index, NativeOverlay { baseline, hooks });
    }
    Ok(())
}
#[cfg(test)]
mod test;
