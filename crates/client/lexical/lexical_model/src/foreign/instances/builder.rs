//! Install the instance runtime before initial-state import and publication.
use super::*;
impl EditorBuilder {
    /// Install an IDs-only instance host before any initial document callbacks.
    pub fn foreign_instance_hooks(mut self, hooks: Arc<dyn ForeignInstanceHooks>) -> Self {
        self.foreign_instance_hooks = Some(hooks);
        self
    }
}
