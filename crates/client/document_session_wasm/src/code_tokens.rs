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
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use wasm_bindgen::JsValue;

#[cfg(test)]
mod test;

thread_local! {
    static PROVIDERS: RefCell<HashMap<u64, Provider>> = RefCell::new(HashMap::new());
    static NEXT: Cell<u64> = const { Cell::new(1) };
}

struct Provider {
    function: js_sys::Function,
    causes: Causes<JsValue>,
}

struct Recorded<Value> {
    entry: u64,
    cause: u32,
    /// Reported in its entry's output, so JS can take it; an uncarried cause was swallowed.
    carried: bool,
    value: Value,
}

/// Thrown values of one provider: at most one, of the current or the latest entry, matching
/// the session's per-entry failure record. Generic so the bounds are tested without wasm.
pub(crate) struct Causes<Value> {
    /// The running session entry; 0 outside every entry.
    entry: u64,
    next_cause: u32,
    recorded: VecDeque<Recorded<Value>>,
    dropped: u32,
}
impl<Value> Default for Causes<Value> {
    fn default() -> Self {
        Self {
            entry: 0,
            next_cause: 1,
            recorded: VecDeque::new(),
            dropped: 0,
        }
    }
}
impl<Value> Causes<Value> {
    /// Start `entry`. A cause the previous output reported but JS did not take can no longer
    /// be learned (the failure record is per entry), so it is retired and counted.
    pub(crate) fn begin(&mut self, entry: u64) {
        let untaken = u32::try_from(self.recorded.len()).unwrap_or(u32::MAX);
        self.dropped = self.dropped.saturating_add(untaken);
        self.recorded.clear();
        self.entry = entry;
    }
    /// Retain a throw of the current entry; `None` when it is dropped, which is counted.
    pub(crate) fn record(&mut self, value: Value) -> Option<u32> {
        let entry = self.entry;
        let admitted = entry != 0 && !self.recorded.iter().any(|recorded| recorded.entry == entry);
        let cause = admitted
            .then_some(self.next_cause)
            .filter(|cause| *cause != 0);
        let Some(cause) = cause else {
            self.dropped = self.dropped.saturating_add(1);
            return None;
        };
        self.next_cause = cause.checked_add(1).unwrap_or(0);
        self.recorded.push_back(Recorded {
            entry,
            cause,
            carried: false,
            value,
        });
        Some(cause)
    }
    /// The current entry's output reported `cause`.
    pub(crate) fn carry(&mut self, cause: u32) -> bool {
        let entry = self.entry;
        self.recorded
            .iter_mut()
            .find(|recorded| recorded.entry == entry && recorded.cause == cause)
            .map(|recorded| recorded.carried = true)
            .is_some()
    }
    /// End the current entry, retiring its cause if no output reported it.
    pub(crate) fn end(&mut self) {
        let entry = self.entry;
        self.recorded
            .retain(|recorded| recorded.entry != entry || recorded.carried);
        self.entry = 0;
    }
    /// Remove a carried cause by its exact (entry, cause); any other pair misses.
    pub(crate) fn take(&mut self, entry: u64, cause: u32) -> Option<Value> {
        let index = self.recorded.iter().position(|recorded| {
            recorded.carried && recorded.entry == entry && recorded.cause == cause
        })?;
        self.recorded.remove(index).map(|recorded| recorded.value)
    }
    /// Retire the current entry's `cause` as a counted drop.
    pub(crate) fn discard(&mut self, cause: u32) {
        let entry = self.entry;
        let before = self.recorded.len();
        self.recorded
            .retain(|recorded| recorded.entry != entry || recorded.cause != cause);
        if self.recorded.len() != before {
            self.dropped = self.dropped.saturating_add(1);
        }
    }
    pub(crate) fn dropped(&self) -> u32 {
        self.dropped
    }
}

fn with_causes<Out>(token: u64, f: impl FnOnce(&mut Causes<JsValue>) -> Out) -> Option<Out> {
    PROVIDERS.with(|map| {
        map.borrow_mut()
            .get_mut(&token)
            .map(|provider| f(&mut provider.causes))
    })
}
/// Session entry hooks, called by the owning machine around each call.
pub(crate) fn begin_entry(token: u64, entry: u64) {
    with_causes(token, |causes| causes.begin(entry));
}
pub(crate) fn carry(token: u64, cause: u32) -> bool {
    with_causes(token, |causes| causes.carry(cause)).unwrap_or(false)
}
pub(crate) fn discard(token: u64, cause: u32) {
    with_causes(token, |causes| causes.discard(cause));
}
pub(crate) fn end_entry(token: u64) {
    with_causes(token, Causes::end);
}
pub(crate) fn take(token: u64, entry: u64, cause: u32) -> Option<JsValue> {
    with_causes(token, |causes| causes.take(entry, cause)).flatten()
}
pub(crate) fn dropped(token: u64) -> u32 {
    with_causes(token, |causes| causes.dropped()).unwrap_or(0)
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
            .with(|map| {
                map.borrow()
                    .get(&self.token)
                    .map(|provider| provider.function.clone())
            })
            .ok_or(CodeTokenError::Host)?;
        // The registry borrow is released across the call; a throw is recorded after it.
        function
            .call4(
                &JsValue::NULL,
                &JsValue::from_str(op),
                &JsValue::from_str(language),
                &JsValue::from_str(text),
                &JsValue::from_str(profile),
            )
            .map_err(|thrown| {
                match with_causes(self.token, |causes| causes.record(thrown)).flatten() {
                    Some(cause) => CodeTokenError::Thrown { cause },
                    None => CodeTokenError::Host,
                }
            })?
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
impl CodeTokenRegistration {
    pub(crate) fn token(&self) -> u64 {
        self.token
    }
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
    PROVIDERS.with(|map| {
        map.borrow_mut().insert(
            token,
            Provider {
                function,
                causes: Causes::default(),
            },
        )
    });
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

fn thrown_cause(error: &lexical_model::Error) -> Option<u32> {
    match error {
        lexical_model::Error::Extension(cause) => match cause.downcast_ref::<CodeTokenError>()? {
            CodeTokenError::Thrown { cause } => Some(*cause),
            _ => None,
        },
        _ => None,
    }
}

/// Tag-16 ordinals and cause ids of the recorded throws an output reports, in the decoded
/// numbering JS sees; `None` when the ordinal cannot be represented. Main-update errors are read
/// from the output from every Session path (local, remote, restore); a follow-up failure carries
/// only plugin and kind in the output, so its cause comes from the reported-error observer at the
/// FollowUpFailed effect's view index.
pub(crate) fn thrown_ordinals(
    view: &[document_session::ViewEffect],
    follow_ups: &[(usize, u32)],
) -> Vec<(Option<u32>, u32)> {
    let main = view.iter().enumerate().filter_map(|(index, effect)| {
        let cause = crate::view_command_scope::model_error(effect).and_then(thrown_cause)?;
        Some((index, cause))
    });
    let follow_up = follow_ups.iter().copied().filter(|(index, _)| {
        matches!(
            view.get(*index),
            Some(document_session::ViewEffect::Editor(
                lexical_model::Effect::FollowUpFailed { .. }
            ))
        )
    });
    let mut reported: Vec<(usize, u32)> = main.chain(follow_up).collect();
    reported.sort_unstable();
    reported.dedup();
    reported
        .into_iter()
        .map(|(index, cause)| {
            (
                crate::view_command_scope::effect_ordinal(view, index).ok(),
                cause,
            )
        })
        .collect()
}

/// Metadata-only observer of reported model errors whose chain holds a recorded throw; it keeps
/// (view index, cause). It runs under the session's report call: no JS, no I/O, no reentry.
#[derive(Default)]
pub(crate) struct CodeTokenObserver(std::sync::Mutex<Vec<(usize, u32)>>);
impl CodeTokenObserver {
    pub(crate) fn take(&self) -> Vec<(usize, u32)> {
        std::mem::take(
            &mut *self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}
impl document_session::ReportedModelErrorObserver for CodeTokenObserver {
    fn reported(&self, error: &lexical_model::Error, view_index: usize) {
        if let Some(cause) = thrown_cause(error) {
            self.0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push((view_index, cause));
        }
    }
}

/// Carry every recorded throw this entry's output reports, as the view-command registry binds
/// its failures.
pub(crate) fn bind_output(
    token: u64,
    entry: u64,
    view: &[document_session::ViewEffect],
    follow_ups: &[(usize, u32)],
) -> Option<CodeTokenFailure> {
    let (mut ordinals, mut causes) = (Vec::new(), Vec::new());
    for (ordinal, cause) in thrown_ordinals(view, follow_ups) {
        match ordinal {
            Some(ordinal) if carry(token, cause) => {
                ordinals.push(ordinal);
                causes.push(cause);
            }
            Some(_) => {}
            // Reported but not addressable: retire it as a counted drop.
            None => discard(token, cause),
        }
    }
    (!causes.is_empty()).then_some(CodeTokenFailure {
        entry,
        ordinals,
        causes,
    })
}

/// The recorded throws reported in one native output, by tag-16 view-effect ordinal.
/// Copy it before consuming that output, then take each cause by (entry, cause).
#[wasm_bindgen::prelude::wasm_bindgen]
pub struct CodeTokenFailure {
    pub(crate) entry: u64,
    pub(crate) ordinals: Vec<u32>,
    pub(crate) causes: Vec<u32>,
}
#[wasm_bindgen::prelude::wasm_bindgen]
impl CodeTokenFailure {
    /// The session entry whose output reported these errors.
    #[wasm_bindgen::prelude::wasm_bindgen(getter)]
    pub fn entry(&self) -> u64 {
        self.entry
    }
    /// View-effect ordinals of the reported errors, parallel to `causes`.
    #[wasm_bindgen::prelude::wasm_bindgen(js_name = effectOrdinals)]
    pub fn effect_ordinals(&self) -> Vec<u32> {
        self.ordinals.clone()
    }
    /// Cause ids to take with `takeCodeTokenCause(entry, cause)`.
    pub fn causes(&self) -> Vec<u32> {
        self.causes.clone()
    }
}
