//! Pure JS hooks dispatch against one independently owned, guarded peer.
use super::*;
use lexical_conformance::api::CallbackRead;
use lexical_model::{ForeignHook, ForeignReadSnapshot};
use std::cell::RefCell;

// serde-wasm-bindgen's Object.entries import does not catch getter/proxy
// exceptions. Own the entire JSON tree under a caught JS boundary first. Keep
// the existing serde decoder and accounting; this does not stringify values.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(inline_js = r#"
export function lexicalSnapshotExport(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('exportJSON must return an object');
    }
    const path = new WeakSet();
    function copy(value) {
        if (value === null || typeof value !== 'object') {
            if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
                throw new TypeError('exportJSON contains a non-JSON value');
            }
            return value;
        }
        if (path.has(value)) throw new TypeError('exportJSON contains a cycle');
        path.add(value);
        let result;
        if (Array.isArray(value)) {
            result = Array.from(value, copy);
        } else {
            result = Object.create(null);
            for (const [key, entry] of Object.entries(value)) result[key] = copy(entry);
        }
        path.delete(value);
        return result;
    }
    return copy(value);
}
"#)]
extern "C" {
    #[wasm_bindgen(catch, js_name = lexicalSnapshotExport)]
    fn snapshot_export(value: &JsValue) -> Result<JsValue, JsValue>;
}

impl BoundFunction {
    fn invoke_export(&self, message: Value, errors: &Errors) -> Result<Value, Error> {
        #[cfg(target_arch = "wasm32")]
        {
            let message = to_js(message).map_err(|error| Error::invariant(format!("{error:?}")))?;
            let result = self
                .function
                .call1(&JsValue::UNDEFINED, &message)
                .and_then(|value| snapshot_export(&value));
            match result {
                Ok(value) => crate::host::from_js(value)
                    .map_err(|error| Error::invariant(format!("{error:?}"))),
                Err(error) => {
                    errors.save(error);
                    Err(Error::Invariant("JS exportJSON threw"))
                }
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (message, errors);
            Err(Error::Invariant("JS callbacks require WASM"))
        }
    }
}

struct ReadFrame<'scope, 'peer, 'editor> {
    owner: &'scope Arc<()>,
    errors: &'scope Errors,
    peer: RefCell<&'scope mut CallbackRead<'peer, 'editor>>,
}
impl ReadFrame<'_, '_, '_> {
    fn with_peer<T>(
        &self,
        operation: impl FnOnce(
            &mut CallbackRead<'_, '_>,
        ) -> Result<T, lexical_conformance::replay::ReplayError>,
    ) -> Result<T, JsValue> {
        let mut peer = self.peer.try_borrow_mut().map_err(|_| {
            JsValue::from(crate::debug::error(
                "read callback is executing a model operation",
            ))
        })?;
        operation(&mut peer).map_err(|error| self.errors.convert(error))
    }
    fn reject<T>(&self) -> Result<T, JsValue> {
        Err(crate::debug::error("editor effects are forbidden in a foreign read scope").into())
    }
}
impl Dispatch for ReadFrame<'_, '_, '_> {
    fn owner(&self) -> &Arc<()> {
        self.owner
    }
    fn call(&self, id: u32, args: Value, receiver: Option<Value>) -> Result<Value, JsValue> {
        self.with_peer(|peer| peer.call(id, args, receiver))
    }
    fn call_native(&self, id: u32, args: Value, receiver: Value) -> Result<Value, JsValue> {
        self.with_peer(|peer| peer.call_native(id, args, receiver))
    }
    fn read_field(&self, handle: u32, field: &str) -> Result<Value, JsValue> {
        self.with_peer(|peer| peer.read_field(handle, field))
    }
    fn listen(
        &self,
        _registration: lexical_model::CommandRegistration,
        _callback: Arc<super::super::host_commands::Listener>,
    ) -> Result<ForeignListenerId, JsValue> {
        self.reject()
    }
    fn unlisten(&self, _id: ForeignListenerId) -> Result<(), JsValue> {
        self.reject()
    }
    fn command(
        &self,
        _command: &lexical_model::Command,
    ) -> Result<lexical_model::Handled, JsValue> {
        self.reject()
    }
    fn register(
        &self,
        _type_name: &str,
        _callback: Arc<Callback>,
    ) -> Result<ForeignListenerId, JsValue> {
        self.reject()
    }
    fn unregister(&self, _id: ForeignListenerId) -> Result<(), JsValue> {
        self.reject()
    }
}

impl Callback {
    pub(crate) fn export_json(
        &self,
        snapshot: &ForeignReadSnapshot,
        key: NodeKey,
    ) -> Result<lexical_model::SerializedNode, Error> {
        self.context
            .with_read_scope(snapshot, |peer| {
                let node = peer.node(key)?;
                let args = peer
                    .original_arguments(key, ForeignHook::AdjustExportJson)?
                    .unwrap_or_default();
                let message =
                    serde_json::to_value(super::super::host_protocol::HostNodeMutation {
                        hook: ForeignHook::AdjustExportJson as u8,
                        node,
                        args,
                    })?;
                let frame = ReadFrame {
                    owner: &self.owner,
                    errors: &self.errors,
                    peer: RefCell::new(peer),
                };
                Ok(CURRENT.set(&frame, || {
                    self.function.invoke_export(message, &self.errors)
                }))
            })
            .map_err(|error| Error::invariant(error.to_string()))??
            .as_object()
            .cloned()
            .ok_or(Error::Invariant("exportJSON must return an object"))
    }
}
