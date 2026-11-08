//! Private payload projections used only while executing an inherited native hook.
use crate::{node::AnyNodeData, *};
use std::{
    any::TypeId,
    sync::{Arc, OnceLock},
};

#[derive(Clone)]
pub(crate) struct ForeignPayload {
    pub user: ForeignData,
    pub native: Arc<dyn AnyNodeData>,
    pub table: NodeVTable,
    pub invalid: Option<Arc<str>>,
}
impl std::fmt::Debug for ForeignPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ForeignPayload")
            .field("user", &self.user)
            .field("native", &self.native)
            .finish()
    }
}
pub(crate) fn parent_table(registry: &Registry, index: NodeTypeIndex) -> NodeVTable {
    let mut entry = registry.node(index);
    while let Some(current) = entry {
        let Some(definition) = &current.foreign else {
            return registry.vtable(current.index).clone();
        };
        entry = definition.extends.and_then(|name| registry.get(name));
    }
    super::dispatch::kind_base(registry.registered(index).kind)
}
impl ForeignPayload {
    pub fn new(
        registry: &Registry,
        index: NodeTypeIndex,
        user: ForeignData,
    ) -> Result<Self, Error> {
        Self::with_table(parent_table(registry, index), user)
    }
    pub fn with_table(table: NodeVTable, user: ForeignData) -> Result<Self, Error> {
        let mut fields = match (table.default_data)().or_else(|| (table.probe)()) {
            Some(default) => default.to_json()?,
            None => SerializedNode::new(),
        };
        fields.extend(user.fields.clone());
        let native = (table.decode)(&fields)?;
        Ok(Self {
            user,
            native,
            table,
            invalid: None,
        })
    }
}

pub(crate) struct NativeProjection {
    pub key: NodeKey,
    table: NodeVTable,
    data: Arc<dyn AnyNodeData>,
    original: Arc<dyn AnyNodeData>,
    changed: bool,
    error: OnceLock<String>,
}
impl NativeProjection {
    fn new(tx: &Transaction<'_>, key: NodeKey) -> Result<Self, Error> {
        let slot = tx.pending.nodes.get(&key).ok_or(Error::NodeNotFound(key))?;
        let payload = slot
            .data
            .as_any()
            .downcast_ref::<ForeignPayload>()
            .ok_or(Error::NodeTypeMismatch(key))?;
        Ok(Self::from_payload(key, payload))
    }
    pub fn from_payload(key: NodeKey, payload: &ForeignPayload) -> Self {
        Self {
            key,
            table: payload.table.clone(),
            data: payload.native.clone(),
            original: payload.native.clone(),
            changed: false,
            error: OnceLock::new(),
        }
    }
    pub fn data(&self) -> &dyn std::any::Any {
        self.data.as_any()
    }
    pub fn refresh(&mut self, payload: &ForeignPayload) {
        if !self.changed && !Arc::ptr_eq(&self.original, &payload.native) {
            *self = Self::from_payload(self.key, payload);
        }
    }
    pub fn fields(&self, user: &ForeignData) -> ForeignData {
        match self.merge_fields(user.fields.clone()) {
            Ok(fields) => ForeignData { fields },
            Err(error) => {
                let _ = self.error.set(error.to_string());
                user.clone()
            }
        }
    }
    pub fn check_error(&self) -> Result<(), Error> {
        match self.error.get() {
            Some(error) => Err(Error::invariant(error.clone())),
            None => Ok(()),
        }
    }
    pub fn snapshot_payload(&self, payload: &ForeignPayload) -> Result<ForeignPayload, Error> {
        let mut snapshot = payload.clone();
        snapshot.user = self.fields(&payload.user);
        self.check_error()?;
        snapshot.native = self.data.clone();
        Ok(snapshot)
    }
    fn merge_fields(&self, mut fields: SerializedNode) -> Result<SerializedNode, Error> {
        self.check_error()?;
        for field in self.original.to_json()?.keys() {
            fields.shift_remove(field);
        }
        fields.extend(self.data.to_json()?);
        Ok(fields)
    }
    pub fn get<Node: NodeType>(&self) -> Option<&Node> {
        (self.table.project)(self.data.as_any(), TypeId::of::<Node>())?.downcast_ref()
    }
    pub fn get_mut<Node: NodeType>(&mut self) -> Result<&mut Node, Error> {
        if Arc::get_mut(&mut self.data).is_none() {
            self.data = self.data.clone_arc();
        }
        let data = Arc::get_mut(&mut self.data).ok_or(Error::Invariant("shared projection"))?;
        let node = (self.table.project_mut)(data.as_any_mut(), TypeId::of::<Node>())
            .and_then(|data| data.downcast_mut())
            .ok_or(Error::NoMutableUpcast(self.key))?;
        self.changed = true;
        Ok(node)
    }
    fn write_back(&self, tx: &mut Transaction<'_>) -> Result<(), Error> {
        self.check_error()?;
        if !self.changed || !tx.pending.nodes.contains_key(&self.key) {
            return Ok(());
        }
        tx.writable(self.key)?;
        let fields = tx
            .foreign_data(self.key)
            .ok_or(Error::NodeTypeMismatch(self.key))?
            .fields
            .clone();
        tx.replace_foreign_fields(self.key, self.merge_fields(fields)?)
    }
}

fn restore(tx: &mut Transaction<'_>, previous: Option<NativeProjection>) -> Result<(), Error> {
    let refreshed = previous
        .as_ref()
        .filter(|frame| tx.pending.nodes.contains_key(&frame.key))
        .map(|frame| NativeProjection::new(tx, frame.key))
        .transpose();
    match refreshed {
        Ok(Some(frame)) => tx.native_projection = Some(frame),
        Ok(None) => tx.native_projection = previous,
        Err(error) => {
            tx.native_projection = previous;
            return Err(error);
        }
    }
    Ok(())
}
pub(crate) fn native<Value>(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    invoke: impl FnOnce(&NodeVTable, &mut Transaction<'_>) -> Result<Value, Error>,
) -> Result<Value, Error> {
    let previous = tx.native_projection.take();
    if let Some(frame) = &previous
        && let Err(error) = frame.write_back(tx)
    {
        tx.native_projection = previous;
        return Err(error);
    }
    let frame = match NativeProjection::new(tx, key) {
        Ok(frame) => frame,
        Err(error) => {
            tx.native_projection = previous;
            return Err(error);
        }
    };
    let table = frame.table.clone();
    tx.native_projection = Some(frame);
    let result = invoke(&table, tx);
    let frame = tx
        .native_projection
        .take()
        .ok_or(Error::Invariant("missing native scope"))?;
    let written = frame.write_back(tx);
    restore(tx, previous)?;
    let value = result?;
    written?;
    Ok(value)
}
/// No native payload is exposed while the host runs, even during reentrant calls.
pub(crate) fn foreign<Value>(
    tx: &mut Transaction<'_>,
    invoke: impl FnOnce(&mut Transaction<'_>) -> Value,
) -> Result<Value, Error> {
    let previous = tx.native_projection.take();
    if let Some(frame) = &previous
        && let Err(error) = frame.write_back(tx)
    {
        tx.native_projection = previous;
        return Err(error);
    }
    let value = invoke(tx);
    restore(tx, previous)?;
    Ok(value)
}
