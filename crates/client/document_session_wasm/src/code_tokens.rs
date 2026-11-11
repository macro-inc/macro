//! Per-session JS code tokenizers for the native code highlighter transform.
//!
//! Document sessions are single-threaded wasm: the registry is thread-local and only the owning
//! thread constructs, calls or drops entries. A threaded wasm build is an unsupported profile.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
compile_error!(
    "document_session_wasm code tokenizers are single-threaded; threaded wasm is unsupported"
);

use macro_document_model::plugins_group_b::{
    CodeToken, CodeTokenError, CodeTokenProvider, CodeTokenRequest, CodeTokenResult, CodeTokens,
};
use serde_json::{Map, Value};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::sync::Arc;
use wasm_bindgen::JsValue;

#[cfg(test)]
mod test;

thread_local! {
    static PROVIDERS: RefCell<HashMap<u64, js_sys::Function>> = RefCell::new(HashMap::new());
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

/// Next token and its successor: never 0, never wraps.
fn next_token(current: u64) -> Option<(u64, u64)> {
    (current != 0).then_some(())?;
    Some((current, current.checked_add(1)?))
}

/// Model-side handle; holds only the token, so it is Send + Sync without unsafe.
struct WasmCodeTokens {
    token: u64,
}
impl CodeTokenProvider for WasmCodeTokens {
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<CodeTokenResult, CodeTokenError> {
        // Clone the function out so no registry borrow is held across the call.
        let function = PROVIDERS
            .with(|map| map.borrow().get(&self.token).cloned())
            .ok_or(CodeTokenError::Host)?;
        let reply = function
            .call3(
                &JsValue::NULL,
                &JsValue::from_str(request.language),
                &JsValue::from_str(request.text),
                &JsValue::from_str(request.profile),
            )
            .map_err(|_| CodeTokenError::Host)?;
        decode(&reply.as_string().ok_or(CodeTokenError::Host)?)
    }
}

/// Owned by its EditorSession; dropping it retires the JS function.
pub(crate) struct CodeTokenRegistration {
    token: u64,
}
impl Drop for CodeTokenRegistration {
    fn drop(&mut self) {
        let removed = PROVIDERS.with(|map| map.borrow_mut().remove(&self.token));
        drop(removed);
    }
}

/// Register a session's tokenizer; the registration must outlive every editor built with it.
pub(crate) fn register(
    function: js_sys::Function,
    profile: &str,
) -> Option<(CodeTokenRegistration, CodeTokens)> {
    let token = NEXT.with(|next| {
        let (token, following) = next_token(next.get())?;
        next.set(following);
        Some(token)
    })?;
    PROVIDERS.with(|map| map.borrow_mut().insert(token, function));
    let provider: Arc<dyn CodeTokenProvider> = Arc::new(WasmCodeTokens { token });
    Some((
        CodeTokenRegistration { token },
        CodeTokens::new(provider, profile),
    ))
}

/// Registered tokenizers on this thread; dev-probes builds only, never shipped.
#[cfg(feature = "dev-probes")]
#[wasm_bindgen::prelude::wasm_bindgen(js_name = debugCodeTokenProviders)]
pub fn debug_code_token_providers() -> u32 {
    PROVIDERS.with(|map| u32::try_from(map.borrow().len()).unwrap_or(u32::MAX))
}

fn exact_keys(object: &Map<String, Value>, keys: &[&str]) -> bool {
    object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
}

fn token(value: &Value) -> Option<CodeToken> {
    let object = value.as_object()?;
    match object.get("kind")?.as_str()? {
        "text" if exact_keys(object, &["kind", "text", "highlightType"]) => Some(CodeToken::Text {
            text: object.get("text")?.as_str()?.to_owned(),
            highlight_type: match object.get("highlightType")? {
                Value::Null => None,
                Value::String(kind) => Some(kind.clone()),
                _ => return None,
            },
        }),
        "lineBreak" if exact_keys(object, &["kind"]) => Some(CodeToken::LineBreak),
        "tab" if exact_keys(object, &["kind"]) => Some(CodeToken::Tab),
        _ => None,
    }
}

/// Strict reply decoding: validate every object and array before building typed tokens.
fn decode(reply: &str) -> Result<CodeTokenResult, CodeTokenError> {
    let value: Value = serde_json::from_str(reply).map_err(|_| CodeTokenError::Host)?;
    let object = value.as_object().ok_or(CodeTokenError::Host)?;
    match object.get("kind").and_then(Value::as_str) {
        Some("notLoaded") if exact_keys(object, &["kind"]) => Ok(CodeTokenResult::NotLoaded),
        Some("tokens") if exact_keys(object, &["kind", "tokens"]) => object
            .get("tokens")
            .and_then(Value::as_array)
            .ok_or(CodeTokenError::Host)?
            .iter()
            .map(|value| token(value).ok_or(CodeTokenError::Host))
            .collect::<Result<_, _>>()
            .map(CodeTokenResult::Tokens),
        _ => Err(CodeTokenError::Host),
    }
}
