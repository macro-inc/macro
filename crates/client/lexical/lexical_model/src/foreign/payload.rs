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
    source: Option<ForeignReadSnapshot>,
) -> Option<Arc<dyn AnyNodeData>> {
    let _scope = super::clone::Scope::enter(source);
    if let Some(payload) = data.as_any().downcast_ref::<ForeignPayload>() {
        let fields = &payload.user;
        let mut entry = registry.node(index);
        while let Some(current) = entry {
            if ForeignReadOperation::check().is_err() {
                return None;
            }
            let Some(definition) = &current.foreign else {
                break;
            };
            match definition.hooks.after_clone(key, original, fields) {
                Override::Value(value) => {
                    let user = value?;
                    return match ForeignPayload::with_table(payload.table.clone(), user.clone()) {
                        Ok(copy) => Some(Arc::new(copy)),
                        Err(error) => failed_clone(payload, user, error),
                    };
                }
                Override::Inherit => {}
            }
            entry = definition.extends.and_then(|parent| registry.get(parent));
        }
        let native = payload.native.after_clone()?;
        if ForeignReadOperation::check().is_err() {
            return None;
        }
        let replacement: Result<ForeignPayload, Error> = (|| {
            let mut fields = payload.user.fields.clone();
            let normalized = native.to_json()?;
            for field in payload.native.to_json()?.keys() {
                if !normalized.contains_key(field) {
                    fields.shift_remove(field);
                }
            }
            fields.extend(normalized);
            Ok(ForeignPayload {
                user: ForeignData { fields },
                native,
                table: payload.table.clone(),
                invalid: payload.invalid.clone(),
            })
        })();
        return match replacement {
            Ok(copy) => Some(Arc::new(copy)),
            Err(error) => failed_clone(payload, payload.user.clone(), error),
        };
    }
    data.after_clone()
}

fn failed_clone(
    payload: &ForeignPayload,
    user: ForeignData,
    error: Error,
) -> Option<Arc<dyn AnyNodeData>> {
    if ForeignReadOperation::is_active() {
        let _ = ForeignReadOperation::defer(error);
        return None;
    }
    // Unscoped native APIs have no fallible return from a clone hook. Retain
    // their existing invalid-payload diagnostic for validation at publication.
    let mut copy = payload.clone();
    copy.user = user;
    copy.invalid = Some(error.to_string().into());
    Some(Arc::new(copy))
}

impl StateRef<'_> {
    /// Check all deferred payload errors, including unchanged records in imported states.
    pub fn check_foreign_payloads(self) -> Result<(), Error> {
        self.check_foreign_payload_keys(self.state.nodes.keys().copied())?;
        Ok(())
    }

    fn check_foreign_payload_keys(self, keys: impl Iterator<Item = NodeKey>) -> Result<u64, Error> {
        if let Some(frame) = self.native_projection {
            frame.check_error()?;
        }
        if !self.state.registry.has_foreign_payloads {
            return Ok(0);
        }
        let mut checked = 0;
        for key in keys {
            let Some(slot) = self.state.nodes.get(&key) else {
                continue;
            };
            if self
                .state
                .registry
                .registered(slot.type_index)
                .foreign
                .is_none()
            {
                continue;
            }
            checked += 1;
            if let Some(payload) = slot.data.as_any().downcast_ref::<ForeignPayload>()
                && let Some(error) = &payload.invalid
            {
                return Err(Error::invariant(error.to_string()));
            }
        }
        Ok(checked)
    }
}

impl Transaction<'_> {
    pub(crate) fn check_pending_foreign_payloads(&mut self) -> Result<(), Error> {
        let view = self.view();
        let checked = if self.full_reconcile {
            view.check_foreign_payload_keys(self.pending.nodes.keys().copied())?
        } else {
            view.check_foreign_payload_keys(
                self.dirty_leaves
                    .iter()
                    .chain(self.dirty_elements.keys())
                    .copied(),
            )?
        };
        #[cfg(feature = "bench-counters")]
        {
            self.work.foreign_payloads_checked += checked;
        }
        #[cfg(not(feature = "bench-counters"))]
        let _ = checked;
        Ok(())
    }
}

#[cfg(all(test, feature = "bench-counters"))]
mod test;
