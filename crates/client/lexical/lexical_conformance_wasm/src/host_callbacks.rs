//! Scoped reborrows for JS callbacks. No pointer to an ancestor transaction is saved.
#[cfg(target_arch = "wasm32")]
use crate::host::to_js;
use lexical_conformance::api::CallbackContext;
use lexical_model::{Error, ForeignListenerId, ForeignTransform, NodeKey, Transaction};
use serde_json::Value;
use std::{cell::Cell, sync::Arc};
use wasm_bindgen::prelude::*;
mod read;

#[derive(Clone, Default)]
pub(super) struct Errors(Arc<std::sync::Mutex<Option<HostValue>>>);
#[derive(Clone)]
pub(super) struct HostValue {
    #[cfg(target_arch = "wasm32")]
    value: JsValue,
}
// Same single-threaded ownership restriction as BoundFunction below.
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Send for HostValue {}
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Sync for HostValue {}
impl std::fmt::Debug for HostValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HostValue")
    }
}
impl HostValue {
    pub(super) fn new(value: JsValue) -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            Self {
                value: crate::debug::returned_handle(value),
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = value;
            Self {}
        }
    }
    #[cfg(target_arch = "wasm32")]
    pub(super) fn to_js(&self) -> JsValue {
        crate::debug::returned_handle(self.value.clone())
    }
}
impl Errors {
    #[cfg(target_arch = "wasm32")]
    fn save(&self, value: JsValue) {
        let previous = {
            self.0
                .lock()
                .expect("callback exception slot")
                .replace(HostValue::new(value))
        };
        drop(previous);
    }
    pub(super) fn take(&self) -> Option<JsValue> {
        let error = { self.0.lock().expect("callback exception slot").take() };
        #[cfg(target_arch = "wasm32")]
        {
            error.map(|error| crate::debug::returned_handle(error.value))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = error;
            None
        }
    }
    pub(super) fn convert(&self, error: impl std::fmt::Display) -> JsValue {
        self.take()
            .unwrap_or_else(|| crate::debug::error(error).into())
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
compile_error!("the development JS host requires single-threaded WASM");

trait Dispatch {
    fn listen(
        &self,
        registration: lexical_model::CommandRegistration,
        callback: Arc<super::host_commands::Listener>,
    ) -> Result<ForeignListenerId, JsValue>;
    fn unlisten(&self, id: ForeignListenerId) -> Result<(), JsValue>;
    fn command(&self, command: &lexical_model::Command) -> Result<lexical_model::Handled, JsValue>;
    fn owner(&self) -> &Arc<()>;
    fn call(&self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value, JsValue>;
    fn read_field(&self, handle: u32, field: &str) -> Result<Value, JsValue>;
    fn call_native(&self, id: u32, args: Value, receiver: Value) -> Result<Value, JsValue>;
    fn register(
        &self,
        type_name: &str,
        callback: Arc<Callback>,
    ) -> Result<ForeignListenerId, JsValue>;
    fn unregister(&self, id: ForeignListenerId) -> Result<(), JsValue>;
}
scoped_tls_hkt::scoped_thread_local!(static CURRENT: for<'a> &'a (dyn Dispatch + 'a));

struct Frame<'scope, 'editor> {
    owner: &'scope Arc<()>,
    context: &'scope CallbackContext,
    errors: &'scope Errors,
    tx: Cell<Option<&'scope mut Transaction<'editor>>>,
}
struct Borrow<'scope, 'editor, 'frame> {
    slot: &'frame Cell<Option<&'scope mut Transaction<'editor>>>,
    tx: Option<&'scope mut Transaction<'editor>>,
}
impl Drop for Borrow<'_, '_, '_> {
    fn drop(&mut self) {
        self.slot.set(self.tx.take());
    }
}
impl Frame<'_, '_> {
    fn with_tx<T>(
        &self,
        operation: impl FnOnce(&mut Transaction<'_>) -> Result<T, JsValue>,
    ) -> Result<T, JsValue> {
        let tx = self.tx.take().ok_or_else(|| {
            JsValue::from(crate::debug::error(
                "callback transaction is executing a model operation",
            ))
        })?;
        let mut borrow = Borrow {
            slot: &self.tx,
            tx: Some(tx),
        };
        operation(borrow.tx.as_deref_mut().expect("scoped transaction"))
    }
}
impl Dispatch for Frame<'_, '_> {
    fn listen(
        &self,
        registration: lexical_model::CommandRegistration,
        callback: Arc<super::host_commands::Listener>,
    ) -> Result<ForeignListenerId, JsValue> {
        self.with_tx(|tx| Ok(tx.register_foreign_listener(registration, callback)))
    }
    fn unlisten(&self, id: ForeignListenerId) -> Result<(), JsValue> {
        self.with_tx(|tx| {
            tx.unregister_foreign_listener(id);
            Ok(())
        })
    }
    fn command(&self, command: &lexical_model::Command) -> Result<lexical_model::Handled, JsValue> {
        self.with_tx(|tx| {
            tx.dispatch(command)
                .map_err(|error| self.errors.convert(error))
        })
    }
    fn register(
        &self,
        type_name: &str,
        callback: Arc<Callback>,
    ) -> Result<ForeignListenerId, JsValue> {
        self.with_tx(|tx| {
            tx.mark_foreign_type_dirty(type_name)
                .map_err(|error| self.errors.convert(error))?;
            tx.register_foreign_transform(type_name, callback)
                .map_err(|error| self.errors.convert(error))
        })
    }
    fn unregister(&self, id: ForeignListenerId) -> Result<(), JsValue> {
        self.with_tx(|tx| {
            tx.unregister_foreign_transform(id);
            Ok(())
        })
    }
    fn owner(&self) -> &Arc<()> {
        self.owner
    }
    fn call(&self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value, JsValue> {
        self.with_tx(|tx| {
            self.context
                .call(tx, id, args, receiver)
                .map_err(|error| self.errors.convert(error))
        })
    }
    fn call_native(&self, id: u32, args: Value, receiver: Value) -> Result<Value, JsValue> {
        self.with_tx(|tx| {
            self.context
                .call_native(tx, id, args, receiver)
                .map_err(|error| self.errors.convert(error))
        })
    }
    fn read_field(&self, handle: u32, field: &str) -> Result<Value, JsValue> {
        self.with_tx(|tx| {
            let snapshot = tx
                .view()
                .snapshot_for_foreign_read()
                .map_err(|error| self.errors.convert(error))?;
            self.context
                .read_field(&snapshot, handle, field)
                .map_err(|error| self.errors.convert(error))
        })
    }
}

fn current<T>(
    owner: &Arc<()>,
    operation: impl FnOnce(&dyn Dispatch) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    if !CURRENT.is_set() {
        return Err(crate::debug::error("no active editor callback").into());
    }
    CURRENT.with(|frame| {
        if !Arc::ptr_eq(owner, frame.owner()) {
            return Err(crate::debug::error("callback belongs to another editor").into());
        }
        operation(frame)
    })
}
pub(super) fn call(
    owner: &Arc<()>,
    id: u32,
    args: Value,
    receiver: Option<Value>,
) -> Result<Value, JsValue> {
    current(owner, |frame| frame.call(id, args, receiver))
}
pub(super) fn call_native(
    owner: &Arc<()>,
    id: u32,
    args: Value,
    receiver: Value,
) -> Result<Value, JsValue> {
    current(owner, |frame| frame.call_native(id, args, receiver))
}
pub(super) fn read_field(owner: &Arc<()>, handle: u32, field: &str) -> Result<Value, JsValue> {
    current(owner, |frame| frame.read_field(handle, field))
}

pub(super) fn register(
    owner: &Arc<()>,
    type_name: &str,
    callback: Arc<Callback>,
) -> Result<ForeignListenerId, JsValue> {
    current(owner, |frame| frame.register(type_name, callback))
}
pub(super) fn unregister(owner: &Arc<()>, id: ForeignListenerId) -> Result<(), JsValue> {
    current(owner, |frame| frame.unregister(id))
}
pub(super) fn listen(
    owner: &Arc<()>,
    registration: lexical_model::CommandRegistration,
    callback: Arc<super::host_commands::Listener>,
) -> Result<ForeignListenerId, JsValue> {
    current(owner, |frame| frame.listen(registration, callback))
}
pub(super) fn unlisten(owner: &Arc<()>, id: ForeignListenerId) -> Result<(), JsValue> {
    current(owner, |frame| frame.unlisten(id))
}
pub(super) fn command(
    owner: &Arc<()>,
    command: &lexical_model::Command,
) -> Result<lexical_model::Handled, JsValue> {
    current(owner, |frame| frame.command(command))
}

// The function can only be held/executed by this single-threaded WASM module.
// Native builds retain no JS value and reject construction before registration.
struct BoundFunction {
    #[cfg(target_arch = "wasm32")]
    function: js_sys::Function,
}
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Send for BoundFunction {}
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Sync for BoundFunction {}
impl BoundFunction {
    fn invoke_opaque(&self, payload: &HostValue, errors: &Errors) -> Result<bool, Error> {
        #[cfg(target_arch = "wasm32")]
        {
            match self.function.call1(&JsValue::UNDEFINED, &payload.to_js()) {
                Ok(value) => {
                    let handled = value.is_truthy();
                    crate::debug::json_payload(&Value::Bool(handled));
                    Ok(handled)
                }
                Err(error) => {
                    errors.save(error);
                    Err(Error::Invariant("JS listener threw"))
                }
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (payload, errors);
            Err(Error::Invariant("JS callbacks require WASM"))
        }
    }
    fn invoke_boolean(&self, value: Value, errors: &Errors) -> Result<bool, Error> {
        #[cfg(target_arch = "wasm32")]
        {
            let argument = to_js(value).map_err(|error| Error::invariant(format!("{error:?}")))?;
            match self.function.call1(&JsValue::UNDEFINED, &argument) {
                Ok(value) => {
                    let result = value.is_truthy();
                    crate::debug::json_payload(&Value::Bool(result));
                    Ok(result)
                }
                Err(error) => {
                    errors.save(error);
                    Err(Error::Invariant("JS node hook threw"))
                }
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (value, errors);
            Err(Error::Invariant("JS callbacks require WASM"))
        }
    }
    fn new(function: js_sys::Function) -> Result<Self, JsValue> {
        #[cfg(target_arch = "wasm32")]
        {
            Ok(Self { function })
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = function;
            Err(crate::debug::error("JS callbacks require WASM").into())
        }
    }
    fn invoke_value(&self, value: Value, errors: &Errors) -> Result<Value, Error> {
        #[cfg(target_arch = "wasm32")]
        {
            let argument = to_js(value).map_err(|error| Error::invariant(format!("{error:?}")))?;
            match self.function.call1(&JsValue::UNDEFINED, &argument) {
                Ok(value) if value.is_undefined() => Ok(serde_json::json!({"$undef":true})),
                Ok(value) => crate::host::from_js(value)
                    .map_err(|error| Error::invariant(format!("{error:?}"))),
                Err(error) => {
                    errors.save(error);
                    Err(Error::Invariant("JS node hook threw"))
                }
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (value, errors);
            Err(Error::Invariant("JS callbacks require WASM"))
        }
    }
    fn invoke(&self, value: Value, errors: &Errors) -> Result<(), Error> {
        #[cfg(target_arch = "wasm32")]
        {
            let argument =
                to_js(value).map_err(|error| Error::InvariantMessage(format!("{error:?}")))?;
            let result = self.function.call1(&JsValue::UNDEFINED, &argument);
            match result {
                Ok(value) => {
                    // Transforms have no return payload; do not deserialize arbitrary JS values.
                    drop(value);
                    Ok(())
                }
                Err(error) => {
                    errors.save(error);
                    Err(Error::Invariant("JS transform threw"))
                }
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (value, errors);
            Err(Error::Invariant("JS callbacks require WASM"))
        }
    }
}

pub(super) struct Callback {
    function: BoundFunction,
    context: CallbackContext,
    owner: Arc<()>,
    errors: Errors,
}
impl Callback {
    fn with_scope<T>(&self, tx: &mut Transaction<'_>, body: impl FnOnce() -> T) -> T {
        let frame = Frame {
            tx: Cell::new(Some(tx)),
            context: &self.context,
            owner: &self.owner,
            errors: &self.errors,
        };
        CURRENT.set(&frame, body)
    }
    pub(super) fn nodes(
        &self,
        tx: &Transaction<'_>,
        keys: &[NodeKey],
    ) -> Result<Vec<Value>, Error> {
        keys.iter()
            .map(|key| {
                self.context
                    .node(tx, *key)
                    .map_err(|error| Error::invariant(error.to_string()))
            })
            .collect()
    }
    pub(super) fn selection(
        &self,
        tx: &mut Transaction<'_>,
        slot: lexical_model::SelectionSlot,
    ) -> Result<Value, Error> {
        self.context
            .selection(tx, slot)
            .map_err(|error| Error::invariant(error.to_string()))
    }
    pub(super) fn node_boolean(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
        args: Vec<Value>,
    ) -> Result<bool, Error> {
        let message = self.node_message(tx, key, hook, args)?;
        self.with_scope(tx, || self.function.invoke_boolean(message, &self.errors))
    }
    pub(super) fn node_optional_result(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
        args: Vec<Value>,
    ) -> Result<Option<NodeKey>, Error> {
        let message = self.node_message(tx, key, hook, args)?;
        let result = self.with_scope(tx, || self.function.invoke_value(message, &self.errors))?;
        if result.is_null() {
            return Ok(None);
        }
        self.context
            .returned_node(tx, &result)
            .map(Some)
            .map_err(|error| Error::invariant(error.to_string()))
    }
    pub(super) fn node_mutation(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
        args: Vec<Value>,
    ) -> Result<(), Error> {
        let message = self.node_message(tx, key, hook, args)?;
        self.with_scope(tx, || self.function.invoke(message, &self.errors))
    }
    pub(super) fn node_result(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
        args: Vec<Value>,
    ) -> Result<NodeKey, Error> {
        let message = self.node_message(tx, key, hook, args)?;
        let result = self.with_scope(tx, || self.function.invoke_value(message, &self.errors))?;
        self.context
            .returned_node(tx, &result)
            .map_err(|error| Error::invariant(error.to_string()))
    }
    pub(super) fn import_node(
        &self,
        tx: &mut Transaction<'_>,
        json: &lexical_model::SerializedNode,
    ) -> Result<NodeKey, Error> {
        let message = serde_json::to_value(super::host_protocol::HostNodeMutation {
            hook: lexical_model::ForeignHook::Import as u8,
            node: Value::Null,
            args: vec![Value::Object(json.clone())],
        })
        .map_err(|error| Error::invariant(error.to_string()))?;
        let result = self.with_scope(tx, || self.function.invoke_value(message, &self.errors))?;
        self.context
            .returned_node(tx, &result)
            .map_err(|error| Error::invariant(error.to_string()))
    }
    pub(super) fn selection_transform(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
    ) -> Result<(), Error> {
        let hook = lexical_model::ForeignHook::SelectionTransform;
        let original = self
            .context
            .original_arguments(tx, key, hook)
            .map_err(|error| Error::invariant(error.to_string()))?;
        let args = match original {
            Some(args) => args,
            None => {
                let previous = match tx.detach_previous_foreign_selection()? {
                    Some(slot) => self.selection(tx, slot)?,
                    None => Value::Null,
                };
                let next = self.selection(tx, lexical_model::SelectionSlot::Active)?;
                vec![previous, next]
            }
        };
        self.node_mutation(tx, key, hook, args)
    }
    fn node_message(
        &self,
        tx: &Transaction<'_>,
        key: NodeKey,
        hook: lexical_model::ForeignHook,
        args: Vec<Value>,
    ) -> Result<Value, Error> {
        let node = self
            .context
            .node(tx, key)
            .map_err(|error| Error::invariant(error.to_string()))?;
        let args = self
            .context
            .original_arguments(tx, key, hook)
            .map_err(|error| Error::invariant(error.to_string()))?
            .unwrap_or(args);
        let message = serde_json::to_value(super::host_protocol::HostNodeMutation {
            hook: hook as u8,
            node,
            args,
        })
        .map_err(|error| Error::invariant(error.to_string()))?;
        Ok(message)
    }

    pub(super) fn command(
        &self,
        tx: &mut Transaction<'_>,
        payload: &HostValue,
    ) -> Result<bool, Error> {
        self.with_scope(tx, || self.function.invoke_opaque(payload, &self.errors))
    }
    pub(super) fn matches(&self, function: &js_sys::Function) -> bool {
        #[cfg(target_arch = "wasm32")]
        {
            self.function.function == *function
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = function;
            false
        }
    }
    pub(super) fn new(
        function: js_sys::Function,
        context: CallbackContext,
        owner: Arc<()>,
        errors: Errors,
    ) -> Result<Self, JsValue> {
        Ok(Self {
            function: BoundFunction::new(function)?,
            context,
            owner,
            errors,
        })
    }
}
impl ForeignTransform for Callback {
    fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
        let node = self
            .context
            .node(tx, key)
            .map_err(|error| Error::InvariantMessage(error.to_string()))?;
        self.with_scope(tx, || self.function.invoke(node, &self.errors))
    }
}
