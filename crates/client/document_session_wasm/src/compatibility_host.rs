//! Scoped host transport. The caller owns the transaction; this module saves no
//! ancestor transaction pointer and never borrows an EditorSession recursively.
use crate::compatibility_generated::owned as wire;
use bebop::Record;
use lexical_model::Error;
use std::sync::atomic::{AtomicU64, Ordering};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
thread_local! {
    static DISPATCHER: RefCell<Option<js_sys::Function>> = const { RefCell::new(None) };
}
static NEXT_SCOPE: AtomicU64 = AtomicU64::new(1);

/// An operation-owned callback lease. Implementations control native borrowing
/// and enforce Mutable/SourceRead/Clone/Creation permissions for each request.
pub trait CallbackScope {
    /// Exact authority advertised to JS for this one synchronous invocation.
    fn context(&self) -> wire::CompatHostContext;
    /// Execute a decoded request against this scope's owned native authority.
    fn call(
        &self,
        request: wire::CompatCallbackRequest,
    ) -> Result<wire::CompatCallbackReply, Error>;
}
scoped_tls_hkt::scoped_thread_local!(static CURRENT: for<'a> &'a (dyn CallbackScope + 'a));

/// Issue a nonzero callback identity. Retired IDs are never reused.
pub fn next_scope_id() -> Result<u64, Error> {
    NEXT_SCOPE
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
        .map_err(|_| Error::Invariant("compatibility callback scope exhausted"))
}

fn valid_context(context: wire::CompatHostContext) -> Result<(), Error> {
    if context.host_slot == 0
        || context.scope_id == 0
        || context.editor_id == 0
        || context.access == wire::CompatHostAccess::Unknown
    {
        return Err(Error::Invariant("invalid compatibility callback scope"));
    }
    Ok(())
}

/// Execute a native-to-host call using an explicit byte transport. No store,
/// transaction, or JS-dispatcher borrow is retained by this boundary.
pub fn invoke_with(
    scope: &dyn CallbackScope,
    request: &wire::CompatHostRequest,
    transport: impl FnOnce(u32, &[u8]) -> Result<Vec<u8>, Error>,
) -> Result<wire::CompatHostReply, Error> {
    let context = scope.context();
    valid_context(context)?;
    if context != request.context {
        return Err(Error::Invariant("compatibility callback context mismatch"));
    }
    validate_invocation(request)?;
    let mut encoded = Vec::new();
    request
        .serialize(&mut encoded)
        .map_err(|error| Error::invariant(error.to_string()))?;
    let response = CURRENT.set(scope, || transport(context.host_slot, &encoded))?;
    let reply = wire::CompatHostReply::deserialize(&response)
        .map_err(|error| Error::invariant(error.to_string()))?;
    validate_reply(request, &reply)?;
    Ok(reply)
}

fn validate_invocation(request: &wire::CompatHostRequest) -> Result<(), Error> {
    use wire::{CompatHostAccess as Access, CompatHostCall as Call};
    let access = request.context.access;
    let valid = match &request.call {
        Call::CompatHostHook { call }
        | Call::CompatHostPublicExport { call }
        | Call::CompatHostSerializedExport { call } => {
            call.call_id != 0
                && call.receiver.capture_id != 0
                && matches!(access, Access::Mutable | Access::SourceRead)
        }
        Call::CompatHostState { call_id, call } => {
            *call_id != 0
                && call.config_id != 0
                && call.operation != wire::ForeignStateOperation::Unknown
        }
        Call::CompatHostClone {
            stage,
            source_record,
        } => {
            stage.stage_id != 0
                && access == Access::Clone
                && stage.source == source_record.record.node
        }
        Call::CompatHostCreation { stage } => {
            stage.stage_id != 0
                && stage.class_id != 0
                && stage.constructor_token != 0
                && stage.record.record.capture_id != 0
                && access == Access::Creation
        }
        _ => false,
    };
    if !valid {
        return Err(Error::Invariant(
            "invalid compatibility callback invocation",
        ));
    }
    Ok(())
}

fn validate_reply(
    request: &wire::CompatHostRequest,
    reply: &wire::CompatHostReply,
) -> Result<(), Error> {
    if request.context.host_slot != reply.host_slot || request.context.scope_id != reply.scope_id {
        return Err(Error::Invariant(
            "compatibility callback reply scope mismatch",
        ));
    }
    use wire::{CompatHostCall as Call, CompatHostResult as Reply};
    let matches = match (&request.call, &reply.result) {
        (_, Reply::CompatHostThrown { error }) => !matches!(
            error,
            wire::ForeignOpaqueValue::Unknown
                | wire::ForeignOpaqueValue::ForeignMissing {}
                | wire::ForeignOpaqueValue::ForeignSlot { slot_id: 0 }
        ),
        (Call::CompatHostHook { call }, Reply::CompatHostHookAck { ack }) => {
            call.call_id == ack.call_id
        }
        (Call::CompatHostClone { stage, .. }, Reply::CompatHostCloneAck { ack }) => {
            stage.stage_id == ack.stage_id
                && stage.ctor_key == ack.ctor_key
                && stage.destination.key == ack.destination_key
        }
        (Call::CompatHostState { call_id, call }, Reply::CompatHostStateAck { ack }) => {
            *call_id == ack.call_id
                && call.config_id == ack.config_id
                && call.operation == ack.operation
        }
        (Call::CompatHostPublicExport { call }, Reply::CompatHostPublicExportAck { ack }) => {
            call.call_id == ack.call_id && call.receiver == ack.record
        }
        (
            Call::CompatHostSerializedExport { call },
            Reply::CompatHostSerializedExportAck { ack },
        ) => call.call_id == ack.call_id && call.receiver == ack.record,
        (Call::CompatHostCreation { stage }, Reply::CompatHostCreationAck { ack }) => {
            stage.stage_id == ack.stage_id
                && stage.record.record == ack.original
                && matches!(&ack.initial_instance, wire::CompatInstanceSeed::CompatCreatedInstance {
                    class_id, instance_owner_id, instance_id, ..
                } if *class_id == stage.class_id && *instance_owner_id == request.context.editor_id && *instance_id != 0)
        }
        _ => false,
    };
    if !matches {
        return Err(Error::Invariant(
            "compatibility callback acknowledgement mismatch",
        ));
    }
    Ok(())
}

/// Invoke the module's installed JS dispatcher without retaining a RefCell guard.
pub fn invoke(
    scope: &dyn CallbackScope,
    request: &wire::CompatHostRequest,
) -> Result<wire::CompatHostReply, Error> {
    invoke_with(scope, request, |host_slot, bytes| {
        #[cfg(target_arch = "wasm32")]
        {
            let dispatcher =
                DISPATCHER
                    .with(|cell| cell.borrow().clone())
                    .ok_or(Error::Invariant(
                        "compatibility host dispatcher is not installed",
                    ))?;
            let result = dispatcher
                .call2(
                    &JsValue::UNDEFINED,
                    &JsValue::from(host_slot),
                    &js_sys::Uint8Array::from(bytes),
                )
                .map_err(|_| Error::Invariant("compatibility host transport threw"))?;
            let result = result
                .dyn_into::<js_sys::Uint8Array>()
                .map_err(|_| Error::Invariant("compatibility host reply must be Uint8Array"))?;
            Ok(result.to_vec())
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (host_slot, bytes);
            Err(Error::Invariant("compatibility JS host requires WASM"))
        }
    })
}

/// Install the single module-stable dispatcher; editor slots remain weak in JS.
#[wasm_bindgen(js_name = installCompatibilityHost)]
pub fn install_compatibility_host(dispatcher: js_sys::Function) -> Result<(), JsError> {
    #[cfg(target_arch = "wasm32")]
    {
        DISPATCHER.with(|cell| {
            let mut stored = cell.borrow_mut();
            if let Some(previous) = stored.as_ref() {
                if !js_sys::Object::is(previous.as_ref(), dispatcher.as_ref()) {
                    return Err(JsError::new(
                        "compatibility host dispatcher already installed",
                    ));
                }
            } else {
                *stored = Some(dispatcher);
            }
            Ok(())
        })
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = dispatcher;
        Err(JsError::new("compatibility JS host requires WASM"))
    }
}

/// Route a callback through the currently active exact lease, rejecting stale,
/// cross-editor and recursively unavailable scopes before invoking native code.
pub fn callback_call(host_slot: u32, scope_id: u64, bytes: &[u8]) -> Result<Vec<u8>, Error> {
    if !CURRENT.is_set() {
        return Err(Error::Invariant("no active compatibility callback"));
    }
    CURRENT.with(|scope| {
        let context = scope.context();
        if host_slot != context.host_slot || scope_id != context.scope_id {
            return Err(Error::Invariant(
                "compatibility callback authority mismatch",
            ));
        }
        let request = wire::CompatCallbackRequest::deserialize(bytes)
            .map_err(|error| Error::invariant(error.to_string()))?;
        let reply = scope.call(request)?;
        let mut output = Vec::new();
        reply
            .serialize(&mut output)
            .map_err(|error| Error::invariant(error.to_string()))?;
        Ok(output)
    })
}

/// Static callback entry point; never receives an already-borrowed EditorSession.
#[wasm_bindgen(js_name = compatibilityCallbackCall)]
pub fn compatibility_callback_call(
    host_slot: u32,
    scope_id: u64,
    bytes: &[u8],
) -> Result<Vec<u8>, JsError> {
    callback_call(host_slot, scope_id, bytes).map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(test)]
mod test;
