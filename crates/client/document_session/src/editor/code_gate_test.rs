//! The native code-highlighting effects stay dormant until a session code tokenizer is installed:
//! a remote code block with no language gets no default and no FIXUP write. With a tokenizer the
//! active path (qualified against Source in the code-highlighting activation) writes the default.
use super::*;
use macro_document_model::plugins_group_b::{
    CodeLanguageRequest, CodeToken, CodeTokenError, CodeTokenProvider, CodeTokenRequest, CodeTokens,
};
use serde_json::Value;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

struct NoGrammars;
impl CodeTokenProvider for NoGrammars {
    fn is_loaded(&self, _: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError> {
        Ok(false)
    }
    fn tokenize(&self, _: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError> {
        Err(CodeTokenError::Host)
    }
}

fn now() -> Now {
    Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    }
}

fn config(tokens: CodeTokens) -> EditorConfig {
    crate::application_editor_config_with_tokens(
        EditorConfig {
            mode: EditorMode::ViewAttached,
            ..EditorConfig::default()
        },
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
        tokens,
    )
}

/// A local view-attached editor receives a remote peer's code block with no language. Returns the
/// local and stored `language` fields as found (None when the key is absent) and the number of
/// FIXUP-origin events.
fn receive_unset_remote_code(tokens: CodeTokens) -> (Option<Value>, Option<Value>, usize) {
    let local_config = config(tokens);
    let policy = local_config.policy;
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut local = EditorSurface::new(local_config, 7, now()).unwrap();
    local
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();

    let remote_doc = lexical_loro::fork_doc(&doc, 60).unwrap();
    let mut remote = EditorSurface::new(config(CodeTokens::none()), 60, now()).unwrap();
    remote
        .init(&remote_doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let mut state = remote.state().to_json().unwrap();
    state.root.insert(
        "children".into(),
        serde_json::json!([
            {"type":"custom-code","previewEnabled":false,"$":{"id":"remote-code"},"children":[
                {"type":"text","text":"plain block","$":{"id":"remote-leaf"}}
            ]}
        ]),
    );
    remote
        .apply(
            &remote_doc,
            Input::SetState {
                state,
                tags: TagSet::default(),
            },
            now(),
            Access::Edit,
            &mut Vec::new(),
        )
        .unwrap();

    let fixups = Arc::new(AtomicUsize::new(0));
    let observed = fixups.clone();
    let _subscription = doc.subscribe_root(Arc::new(move |event| {
        if event.origin == FIXUP_ORIGIN {
            observed.fetch_add(1, Ordering::Relaxed);
        }
    }));
    doc.import(
        &remote_doc
            .export(loro::ExportMode::updates(&doc.oplog_vv()))
            .unwrap(),
    )
    .unwrap();
    local
        .remote_pending(&doc, now(), Access::Edit, &mut Vec::new(), false)
        .unwrap();
    let local_language = local.state().to_json().unwrap().root["children"][0]
        .get("language")
        .cloned();
    let stored = lexical_loro::reconstruct_state(&doc, policy).unwrap();
    let stored_language = stored.root["children"][0].get("language").cloned();
    (
        local_language,
        stored_language,
        fixups.load(Ordering::Relaxed),
    )
}

#[test]
fn a_remote_unset_code_block_gets_no_default_or_fixup_without_a_tokenizer() {
    let (local, stored, fixups) = receive_unset_remote_code(CodeTokens::none());
    // Unset means absent or null; key presence is not asserted, so this claims no null-presence parity.
    let unset = |field: &Option<Value>| matches!(field, None | Some(Value::Null));
    assert!(unset(&local), "local language {local:?}");
    assert!(unset(&stored), "stored language {stored:?}");
    assert_eq!(fixups, 0);
}

// Control for the harness: the active path writes the default back as FIXUP. Whether Source does
// the same for remote updates is qualified in the code-highlighting activation, not here.
#[test]
fn with_a_tokenizer_the_active_path_writes_the_remote_default_as_fixup() {
    let tokens = CodeTokens::new(Arc::new(NoGrammars), "no-grammars");
    let (local, stored, fixups) = receive_unset_remote_code(tokens);
    assert_eq!(local, Some(serde_json::json!("plaintext")));
    assert_eq!(stored, Some(serde_json::json!("plaintext")));
    assert!(fixups > 0);
}

/// Answers every call (all languages loaded, one plain token per text) except call number
/// `throw_at`, which throws; counts every call.
struct ThrowAt {
    calls: AtomicUsize,
    throw_at: usize,
}
impl ThrowAt {
    fn call(&self) -> Result<(), CodeTokenError> {
        let call = self.calls.fetch_add(1, Ordering::Relaxed) + 1;
        if call == self.throw_at {
            return Err(CodeTokenError::Thrown { cause: call as u32 });
        }
        Ok(())
    }
}
impl CodeTokenProvider for ThrowAt {
    fn is_loaded(&self, _: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError> {
        self.call().map(|()| true)
    }
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError> {
        self.call()?;
        Ok(if request.text.is_empty() {
            Vec::new()
        } else {
            vec![CodeToken::Text {
                text: request.text.to_owned(),
                highlight_type: None,
            }]
        })
    }
}

fn code_state(surface: &EditorSurface) -> lexical_model::SerializedEditorState {
    let mut state = surface.state().to_json().unwrap();
    state.root.insert(
        "children".into(),
        serde_json::json!([
            {"type":"custom-code","language":"rust","previewEnabled":false,"children":[
                {"type":"text","text":"fn main() {}"}
            ]}
        ]),
    );
    state
}

/// Which phase reports a throw at tokenizer call `throw_at` during a local edit that creates a
/// code block: (calls made, main update error, follow-up failure).
fn local_code_edit(throw_at: usize) -> (usize, bool, bool) {
    let provider = Arc::new(ThrowAt {
        calls: AtomicUsize::new(0),
        throw_at,
    });
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut local = EditorSurface::new(
        config(CodeTokens::new(provider.clone(), "throw-at")),
        7,
        now(),
    )
    .unwrap();
    local
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let state = code_state(&local);
    let mut view = Vec::new();
    let _ = local.apply(
        &doc,
        Input::SetState {
            state,
            tags: TagSet::default(),
        },
        now(),
        Access::Edit,
        &mut view,
    );
    let main = view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(_)));
    let follow_up = view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. })));
    (provider.calls.load(Ordering::Relaxed), main, follow_up)
}

// Carrier E3 reachability pin: a local SetState with a code block calls the tokenizer only
// inside follow-up updates, so every throw surfaces as FollowUpFailed (which carries no
// takeable cause) and none as a main-update error. A change in either direction fails here.
#[test]
fn follow_up_reachability_of_the_tokenizer_in_a_local_code_edit() {
    let (calls, main, follow_up) = local_code_edit(0);
    assert!(calls > 0 && !main && !follow_up, "baseline: {calls} calls");
    for throw_at in 1..=calls {
        assert_eq!(
            local_code_edit(throw_at),
            (throw_at, false, true),
            "throw at call {throw_at} of {calls}"
        );
    }
}

// Carrier E4 reachability pin: does initializing a surface over a stored code block call the
// tokenizer?
#[test]
fn init_reachability_of_the_tokenizer_over_a_stored_code_block() {
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut writer = EditorSurface::new(config(CodeTokens::none()), 7, now()).unwrap();
    writer
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let state = code_state(&writer);
    writer
        .apply(
            &doc,
            Input::SetState {
                state,
                tags: TagSet::default(),
            },
            now(),
            Access::Edit,
            &mut Vec::new(),
        )
        .unwrap();
    let stored = lexical_loro::fork_doc(&doc, 61).unwrap();
    let provider = Arc::new(ThrowAt {
        calls: AtomicUsize::new(0),
        throw_at: 0,
    });
    let mut reader = EditorSurface::new(
        config(CodeTokens::new(provider.clone(), "throw-at")),
        61,
        now(),
    )
    .unwrap();
    let mut view = Vec::new();
    reader
        .init(&stored, now(), Access::Edit, &mut view)
        .unwrap();
    let calls = provider.calls.load(Ordering::Relaxed);
    assert_eq!(calls, 0);
}
