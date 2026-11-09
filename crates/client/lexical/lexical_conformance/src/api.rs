//! Shared upstream API dispatch for recorded fixtures and the development WASM host.
use crate::replay::{Replayer, Result, fail};
use lexical_model::Transaction;
use serde_json::Value;

include!(concat!(env!("OUT_DIR"), "/api_index.rs"));

mod context;
pub use context::{CallbackContext, CallbackRead, Context};
mod session;
pub use session::Session;

/// Every explicitly mapped API name, sorted in stable dispatch-ID order.
///
/// Generated from the dispatch match arms, so adding an operation cannot leave
/// a second, manually maintained WASM operation table behind.
pub fn index() -> &'static [&'static str] {
    API_INDEX
}

/// Invoke an indexed operation with fixture-encoded arguments and receiver.
pub fn call_by_id(
    r: &mut Replayer,
    tx: &mut Transaction<'_>,
    id: u32,
    args: Value,
    receiver: Option<Value>,
) -> Result<Value> {
    let name = index()
        .get(id as usize)
        .ok_or_else(|| fail(format!("unknown API id {id}")))?;
    let mut op = serde_json::json!({"fn": name, "args": args});
    if let Some(receiver) = receiver {
        op["this"] = receiver;
    }
    let previous = r.in_callback;
    r.in_callback = true;
    let result = call(r, tx, &op);
    r.in_callback = previous;
    result
}

/// Invoke the shared dispatcher and preserve detached selection identities.
///
/// Arguments and receiver use the recorder's value encoding. The development
/// host owns the same identity bookkeeping as a fixture replay.
pub fn call(r: &mut Replayer, tx: &mut Transaction<'_>, op: &Value) -> Result<Value> {
    let operation = lexical_model::ForeignReadOperation::begin()?;
    r.selections.synchronize(tx)?;
    let result = lexical::call(r, tx, op);
    if lexical_model::ForeignReadOperation::check().is_ok() {
        r.selections.synchronize(tx)?;
    }
    operation.finish(result)
}

pub(crate) mod lexical;
pub(crate) mod nodes;
pub(crate) mod properties;
pub(crate) mod selection;

pub(crate) mod caret;

pub(crate) mod rich;

pub(crate) mod markdown;

pub(crate) mod macro_model;

pub(crate) mod wire;

mod macro_edit;
pub(crate) mod tab;

#[cfg(test)]
mod test;
