//! Per-session JS code tokenizers for the native code highlighter transform.
//!
//! Document sessions are single-threaded wasm: the registry is thread-local and only the owning
//! thread constructs, calls or drops entries. A threaded wasm build is an unsupported profile.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
compile_error!(
    "document_session_wasm code tokenizers are single-threaded; threaded wasm is unsupported"
);

use macro_document_model::plugins_group_b::{
    CodeLanguageRequest, CodeToken, CodeTokenError, CodeTokenProvider, CodeTokenRequest, CodeTokens,
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
impl WasmCodeTokens {
    /// Call the session's fenced JS function as `(op, language, text, profile)` and return its
    /// string reply. The registry borrow is released before the call.
    fn call(
        &self,
        op: &str,
        language: &str,
        text: &str,
        profile: &str,
    ) -> Result<String, CodeTokenError> {
        let function = PROVIDERS
            .with(|map| map.borrow().get(&self.token).cloned())
            .ok_or(CodeTokenError::Host)?;
        function
            .call4(
                &JsValue::NULL,
                &JsValue::from_str(op),
                &JsValue::from_str(language),
                &JsValue::from_str(text),
                &JsValue::from_str(profile),
            )
            .map_err(|_| CodeTokenError::Host)?
            .as_string()
            .ok_or(CodeTokenError::Host)
    }
}
impl CodeTokenProvider for WasmCodeTokens {
    fn is_loaded(&self, request: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError> {
        decode_loaded(&self.call("loaded", request.language, "", request.profile)?)
    }
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError> {
        decode_tokens(&self.call("tokenize", request.language, request.text, request.profile)?)
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

/// Strict `loaded` reply: exactly `{"kind":"loaded","loaded":bool}`.
fn decode_loaded(reply: &str) -> Result<bool, CodeTokenError> {
    let value: Value = serde_json::from_str(reply).map_err(|_| CodeTokenError::Host)?;
    let object = value.as_object().ok_or(CodeTokenError::Host)?;
    match (
        object.get("kind").and_then(Value::as_str),
        object.get("loaded"),
    ) {
        (Some("loaded"), Some(Value::Bool(loaded))) if exact_keys(object, &["kind", "loaded"]) => {
            Ok(*loaded)
        }
        _ => Err(CodeTokenError::Host),
    }
}

/// Strict `tokenize` reply: validate every object and array before building typed tokens.
fn decode_tokens(reply: &str) -> Result<Vec<CodeToken>, CodeTokenError> {
    let value: Value = serde_json::from_str(reply).map_err(|_| CodeTokenError::Host)?;
    let object = value.as_object().ok_or(CodeTokenError::Host)?;
    match object.get("kind").and_then(Value::as_str) {
        Some("tokens") if exact_keys(object, &["kind", "tokens"]) => object
            .get("tokens")
            .and_then(Value::as_array)
            .ok_or(CodeTokenError::Host)?
            .iter()
            .map(|value| token(value).ok_or(CodeTokenError::Host))
            .collect(),
        _ => Err(CodeTokenError::Host),
    }
}
