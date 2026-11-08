//! Scoped reborrows for JS callbacks. No pointer to an ancestor transaction is saved.
#[cfg(target_arch = "wasm32")]
use crate::host::to_js;
use lexical_conformance::api::CallbackContext;
use lexical_model::{Error, ForeignListenerId, ForeignTransform, NodeKey, Transaction};
use serde_json::Value;
use std::{cell::Cell, sync::Arc};
use wasm_bindgen::prelude::*;

#[derive(Clone, Default)]
pub(super) struct Errors(Arc<std::sync::Mutex<Option<Thrown>>>);
struct Thrown {
    #[cfg(target_arch = "wasm32")]
    value: JsValue,
}
// Same single-threaded ownership restriction as BoundFunction below.
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Send for Thrown {}
#[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
unsafe impl Sync for Thrown {}
impl Errors {
    #[cfg(target_arch = "wasm32")]
    fn save(&self, value: JsValue) {
        let previous = {
            self.0
                .lock()
                .expect("callback exception slot")
                .replace(Thrown {
                    value: crate::debug::returned_handle(value),
                })
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
    fn owner(&self) -> &Arc<()>;
    fn call(&self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value, JsValue>;
    fn read_field(&self, handle: u32, field: &str) -> Result<Value, JsValue>;
    fn register(
        &self,
        type_name: &str,
        callback: Arc<Transform>,
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
    fn register(
        &self,
        type_name: &str,
        callback: Arc<Transform>,
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
pub(super) fn read_field(owner: &Arc<()>, handle: u32, field: &str) -> Result<Value, JsValue> {
    current(owner, |frame| frame.read_field(handle, field))
}

pub(super) fn register(
    owner: &Arc<()>,
    type_name: &str,
    callback: Arc<Transform>,
) -> Result<ForeignListenerId, JsValue> {
    current(owner, |frame| frame.register(type_name, callback))
}
pub(super) fn unregister(owner: &Arc<()>, id: ForeignListenerId) -> Result<(), JsValue> {
    current(owner, |frame| frame.unregister(id))
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

pub(super) struct Transform {
    function: BoundFunction,
    context: CallbackContext,
    owner: Arc<()>,
    errors: Errors,
}
impl Transform {
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
impl ForeignTransform for Transform {
    fn transform(&self, tx: &mut Transaction<'_>, key: NodeKey) -> Result<(), Error> {
        let node = self
            .context
            .node(tx, key)
            .map_err(|error| Error::InvariantMessage(error.to_string()))?;
        let frame = Frame {
            tx: Cell::new(Some(tx)),
            context: &self.context,
            owner: &self.owner,
            errors: &self.errors,
        };
        CURRENT.set(&frame, || self.function.invoke(node, &self.errors))
    }
}
