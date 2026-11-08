//! Runtime payload cloning and JSON storage.
use super::projection::ForeignPayload;
use crate::{node::AnyNodeData, *};
use std::{any::Any, sync::Arc};

impl AnyNodeData for ForeignPayload {
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn clone_arc(&self) -> Arc<dyn AnyNodeData> {
        Arc::new(self.clone())
    }
    fn after_clone(&self) -> Option<Arc<dyn AnyNodeData>> {
        None
    }
    fn to_json(&self) -> Result<SerializedNode, Error> {
        if let Some(error) = &self.invalid {
            return Err(Error::invariant(error.to_string()));
        }
        Ok(self.user.fields.clone())
    }
    fn dyn_eq(&self, other: &dyn AnyNodeData) -> bool {
        other
            .as_any()
            .downcast_ref::<Self>()
            .is_some_and(|other| self.user == other.user)
    }
}
impl<'state> StateRef<'state> {
    /// Own fields of a runtime node; native typed payload APIs do not match it.
    pub fn foreign_data(self, key: impl Into<NodeKey>) -> Option<&'state ForeignData> {
        Some(
            &self
                .slot(key.into())?
                .data
                .as_any()
                .downcast_ref::<ForeignPayload>()?
                .user,
        )
    }
}
impl Transaction<'_> {
    /// Allocate a runtime node without attaching it to the document.
    pub fn create_foreign(
        &mut self,
        type_name: &str,
        fields: SerializedNode,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let index = self.view().state.registry.get_or_err(type_name)?.index;
        if self
            .view()
            .state
            .registry
            .registered(index)
            .foreign
            .is_none()
        {
            return Err(Error::Invariant("expected runtime node type"));
        }
        let data = ForeignData { fields };
        let base = (self.pending.registry.vtable(index).initial_base)(&data)?;
        let data = ForeignPayload::new(&self.pending.registry, index, data)?;
        self.insert_record(index, Arc::new(data), base)
    }
    /// Change one own runtime property, preserving insertion order.
    pub fn set_foreign_field(
        &mut self,
        key: NodeKey,
        field: &str,
        value: serde_json::Value,
    ) -> Result<(), Error> {
        self.writable(key)?;
        let mut fields = self
            .foreign_data(key)
            .ok_or(Error::NodeTypeMismatch(key))?
            .fields
            .clone();
        fields.insert(field.to_owned(), value);
        self.replace_foreign_fields(key, fields)
    }
    pub(crate) fn replace_foreign_fields(
        &mut self,
        key: NodeKey,
        fields: SerializedNode,
    ) -> Result<(), Error> {
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        let data = ForeignPayload::new(&self.pending.registry, index, ForeignData { fields })?;
        self.writable(key)?.data = Arc::new(data);
        Ok(())
    }
}

pub(crate) fn clone_payload(
    registry: &Registry,
    index: NodeTypeIndex,
    key: NodeKey,
    original: NodeKey,
    data: &Arc<dyn AnyNodeData>,
) -> Option<Arc<dyn AnyNodeData>> {
    if let Some(payload) = data.as_any().downcast_ref::<ForeignPayload>() {
        let fields = &payload.user;
        let mut entry = registry.node(index);
        while let Some(current) = entry {
            let Some(definition) = &current.foreign else {
                break;
            };
            match definition.hooks.after_clone(key, original, fields) {
                Override::Value(value) => {
                    return value.map(|user| {
                        let copy =
                            match ForeignPayload::with_table(payload.table.clone(), user.clone()) {
                                Ok(copy) => copy,
                                Err(error) => {
                                    let mut copy = payload.clone();
                                    copy.user = user;
                                    copy.invalid = Some(error.to_string().into());
                                    copy
                                }
                            };
                        Arc::new(copy) as Arc<dyn AnyNodeData>
                    });
                }
                Override::Inherit => {}
            }
            entry = definition.extends.and_then(|parent| registry.get(parent));
        }
    }
    data.after_clone()
}

impl StateRef<'_> {
    /// Check deferred errors from infallible record-clone hooks before publication.
    pub fn check_foreign_payloads(self) -> Result<(), Error> {
        if let Some(frame) = self.native_projection {
            frame.check_error()?;
        }
        for slot in self.state.nodes.values() {
            if let Some(payload) = slot.data.as_any().downcast_ref::<ForeignPayload>()
                && let Some(error) = &payload.invalid
            {
                return Err(Error::invariant(error.to_string()));
            }
        }
        Ok(())
    }
}
