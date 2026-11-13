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
            ]},
            // The editing peer writes the trailing paragraph in its own update (two-OFF a5fe77b8).
            {"type":"paragraph","$":{"id":"remote-trailing"},"children":[]}
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

// Carrier E3 reachability pin: an id-less local SetState with a code block calls the tokenizer
// only inside follow-up updates (the id-assigning round, as Source's nodeIdPlugin update), so
// every throw surfaces as FollowUpFailed, with its cause reported to the observer, and none as a
// main-update error. A change in either direction fails here.
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

/// Two-OFF probe (a5fe77b8): the EDITING peer that turns ``` + Enter into a code block writes the
/// trailing paragraph inside its own single update; the receiver has nothing to fix up.
#[test]
fn the_editing_peer_writes_the_trailing_paragraph_in_its_own_update() {
    let doc = lexical_loro::new_doc(7).unwrap();
    lexical_loro::mirror::set_state(
        &doc,
        &serde_json::json!({
            "type":"root","version":1,"format":"","indent":0,"direction":null,
            "$":{"id":"root"},
            "children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
                "$":{"id":"editing-paragraph"},"textFormat":0,"textStyle":"","children":[]}]
        }),
    )
    .unwrap();
    let mut editing = EditorSurface::new(config(CodeTokens::none()), 7, now()).unwrap();
    editing
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let paragraph = editing.state().first_child_or_err(NodeKey::ROOT).unwrap();
    let point = Point::element(paragraph, ChildIndex(0));
    for (index, character) in "```".chars().enumerate() {
        let selection = if index == 0 {
            ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            }
        } else {
            ViewSelection::KeepModel
        };
        editing
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText(character.to_string()),
                    selection,
                },
                now(),
                Access::Edit,
                &mut Vec::new(),
            )
            .unwrap();
    }
    let before = doc.oplog_vv();
    editing
        .apply(
            &doc,
            Input::KeyDown {
                event: KeyEvent {
                    key: "Enter".into(),
                    ..KeyEvent::default()
                },
                routed: Some(Command::Key {
                    command: KeyCommand::Enter,
                    event: Some(KeyEvent {
                        key: "Enter".into(),
                        ..KeyEvent::default()
                    }),
                }),
                routed_prevent_default: true,
                selection: ViewSelection::KeepModel,
            },
            now(),
            Access::Edit,
            &mut Vec::new(),
        )
        .unwrap();
    let types: Vec<Value> = editing.state().to_json().unwrap().root["children"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|child| child["type"].clone())
        .collect();
    let updates =
        serde_json::to_value(doc.export_json_updates(&before, &doc.oplog_vv()).unwrap()).unwrap();
    assert_eq!(
        updates["changes"].as_array().map(Vec::len),
        Some(1),
        "one update"
    );
    assert_eq!(
        types.first().and_then(Value::as_str),
        Some("custom-code"),
        "``` + Enter made a code block: {types:?}"
    );
    assert_eq!(
        types.last().and_then(Value::as_str),
        Some("paragraph"),
        "{types:?}"
    );
    assert_eq!(types.len(), 2, "{types:?}");
}

/// Counts every tokenizer call by kind; call number `throw_at` (1-based) fails instead.
struct CountingTokens {
    calls: std::sync::Mutex<Vec<&'static str>>,
    throw_at: usize,
}
impl CountingTokens {
    fn call(&self, kind: &'static str) -> Result<(), CodeTokenError> {
        let mut calls = self.calls.lock().unwrap();
        calls.push(kind);
        if calls.len() == self.throw_at {
            return Err(CodeTokenError::Host);
        }
        Ok(())
    }
}
impl CodeTokenProvider for CountingTokens {
    fn is_loaded(&self, _: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError> {
        self.call("loaded").map(|()| true)
    }
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError> {
        self.call("tokenize")?;
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

#[derive(Debug, PartialEq)]
struct SetStateRun {
    calls: Vec<&'static str>,
    main_error: bool,
    follow_up_failed: bool,
    stored_version: Option<Value>,
    /// Non-root nodes without an id after the SetState.
    nodes_without_id: usize,
}

/// A local SetState of one custom-code block, with or without node ids and with the root
/// documentMetadata absent, stale (1) or current (10), the app's load shape.
fn set_state_run(ids: bool, metadata: Option<u32>, throw_at: usize) -> SetStateRun {
    let provider = Arc::new(CountingTokens {
        calls: std::sync::Mutex::new(Vec::new()),
        throw_at,
    });
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut local = EditorSurface::new(
        config(CodeTokens::new(provider.clone(), "counting")),
        7,
        now(),
    )
    .unwrap();
    local
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let mut state = local.state().to_json().unwrap();
    let mut code = serde_json::json!({"type":"custom-code","language":"rust","previewEnabled":false,
        "children":[{"type":"text","text":"fn main() {}"}]});
    if ids {
        code["$"] = serde_json::json!({"id":"codeid01"});
        code["children"][0]["$"] = serde_json::json!({"id":"textid01"});
    }
    state
        .root
        .insert("children".into(), serde_json::json!([code]));
    if let Some(version) = metadata {
        state.root.insert(
            "$".into(),
            serde_json::json!({"documentMetadata":{"version":version}}),
        );
    }
    let before = provider.calls.lock().unwrap().len();
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
    let calls = provider.calls.lock().unwrap()[before..].to_vec();
    fn missing(node: &Value) -> usize {
        let own = usize::from(node["$"]["id"].as_str().is_none_or(str::is_empty));
        own + node["children"]
            .as_array()
            .map_or(0, |children| children.iter().map(missing).sum())
    }
    let nodes_without_id = local.state().to_json().unwrap().root["children"]
        .as_array()
        .map_or(0, |children| children.iter().map(missing).sum());
    SetStateRun {
        nodes_without_id,
        calls,
        main_error: view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))),
        follow_up_failed: view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. }))),
        stored_version: local
            .state()
            .to_json()
            .unwrap()
            .root
            .get("$")
            .and_then(|state| state.get("documentMetadata"))
            .and_then(|metadata| metadata.get("version"))
            .cloned(),
    }
}

// Source control (app composition, apps/web source-setstate-tokenize.source-control.test.ts):
// setEditorState runs no transform; nodeIdPlugin's created-mutation update writes ids only to
// id-less nodes, and that update tokenizes the code block once; documentMetadataPlugin's
// history-merge update dirties ROOT only and follows only an update with mutated nodes.
// Ids present: 0 tokenizer calls. Ids missing: 1 tokenize, in the follow-up (id assignment).
#[test]
fn set_state_tokenizes_exactly_as_the_source_app() {
    let mut actual = Vec::new();
    let mut expected = Vec::new();
    for ids in [false, true] {
        for metadata in [None, Some(1), Some(10)] {
            let run = set_state_run(ids, metadata, 0);
            let tokenize = run.calls.iter().filter(|kind| **kind == "tokenize").count();
            // Each tokenize call's phase: failing it must give a follow-up failure, never a
            // main-update error.
            let phases: Vec<(bool, bool)> = run
                .calls
                .iter()
                .enumerate()
                .filter(|(_, kind)| **kind == "tokenize")
                .map(|(index, _)| {
                    let failed = set_state_run(ids, metadata, index + 1);
                    (failed.main_error, failed.follow_up_failed)
                })
                .collect();
            eprintln!(
                "ids={ids} metadata={metadata:?} calls={:?} tokenize={tokenize} phases(main,follow_up)={phases:?} stored_version={:?}",
                run.calls, run.stored_version
            );
            // The follow-up half still covers nodes created outside transforms (this SetState's
            // main update runs none).
            assert_eq!(run.nodes_without_id, 0, "ids={ids} metadata={metadata:?}");
            actual.push((ids, metadata, tokenize, phases));
            expected.push((
                ids,
                metadata,
                usize::from(!ids),
                if ids { vec![] } else { vec![(false, true)] },
            ));
        }
    }
    assert_eq!(actual, expected);
}

/// Counts tokenizer calls; the call numbered `throw_at` (1-based, set after setup) fails.
struct ArmedTokens {
    calls: std::sync::Mutex<Vec<&'static str>>,
    throw_at: AtomicUsize,
}
impl ArmedTokens {
    fn call(&self, kind: &'static str) -> Result<(), CodeTokenError> {
        let mut calls = self.calls.lock().unwrap();
        calls.push(kind);
        if calls.len() == self.throw_at.load(Ordering::Relaxed) {
            return Err(CodeTokenError::Host);
        }
        Ok(())
    }
}
impl CodeTokenProvider for ArmedTokens {
    fn is_loaded(&self, _: &CodeLanguageRequest<'_>) -> Result<bool, CodeTokenError> {
        self.call("loaded").map(|()| true)
    }
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<Vec<CodeToken>, CodeTokenError> {
        self.call("tokenize")?;
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

#[derive(Debug, PartialEq)]
struct TypingRun {
    calls: Vec<&'static str>,
    main_error: bool,
    follow_up_failed: bool,
    /// Loro changes the typing produced; follow-up rounds commit as their own changes.
    loro_changes: Option<usize>,
    /// Code-highlight children of the block without a node id after the typing.
    highlights_without_id: usize,
}

/// Load one custom-code block with node ids, then type one character at the end of its last
/// text (a shipping flow). Setup calls are excluded; `throw_at` counts typing calls (1-based).
fn type_into_code(throw_at: usize) -> TypingRun {
    let provider = Arc::new(ArmedTokens {
        calls: std::sync::Mutex::new(Vec::new()),
        throw_at: AtomicUsize::new(0),
    });
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut local =
        EditorSurface::new(config(CodeTokens::new(provider.clone(), "armed")), 7, now()).unwrap();
    local
        .init(&doc, now(), Access::Edit, &mut Vec::new())
        .unwrap();
    let mut state = local.state().to_json().unwrap();
    state.root.insert(
        "children".into(),
        serde_json::json!([{"type":"custom-code","language":"rust","previewEnabled":false,
            "$":{"id":"codeid01"},
            "children":[{"type":"text","text":"fn main() {}","$":{"id":"textid01"}}]}]),
    );
    local
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
    let code = local.state().first_child_or_err(NodeKey::ROOT).unwrap();
    let last = local.state().last_child_or_err(code).unwrap();
    let end = local
        .state()
        .view()
        .text(last)
        .map_or(Utf16Offset(0), |text| text.text.utf16_len());
    let point = Point::text(last, end);
    let before = provider.calls.lock().unwrap().len();
    let version = doc.oplog_vv();
    if throw_at > 0 {
        provider
            .throw_at
            .store(before + throw_at, Ordering::Relaxed);
    }
    let mut view = Vec::new();
    let _ = local.apply(
        &doc,
        Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        },
        now(),
        Access::Edit,
        &mut view,
    );
    let updates =
        serde_json::to_value(doc.export_json_updates(&version, &doc.oplog_vv()).unwrap()).unwrap();
    let children = local.state().to_json().unwrap().root["children"][0]["children"].clone();
    let highlights_without_id = children
        .as_array()
        .map(|children| {
            children
                .iter()
                .filter(|child| child["type"] == "code-highlight" && child["$"]["id"].is_null())
                .count()
        })
        .unwrap_or(0);
    TypingRun {
        loro_changes: updates["changes"].as_array().map(Vec::len),
        highlights_without_id,
        calls: provider.calls.lock().unwrap()[before..].to_vec(),
        main_error: view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))),
        follow_up_failed: view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. }))),
    }
}

// Source control (apps/web source-setstate-tokenize.source-control.test.ts, typing case): one
// typed character in a loaded code block tokenizes ONCE, inside the typing update itself; the ids
// of the highlight nodes it creates are assigned in that same update (nodeIdPlugin transform).
#[test]
fn typing_into_a_loaded_code_block_tokenizes_once_in_the_typing_update() {
    let run = type_into_code(0);
    let tokenize: Vec<usize> = run
        .calls
        .iter()
        .enumerate()
        .filter(|(_, kind)| **kind == "tokenize")
        .map(|(index, _)| index + 1)
        .collect();
    let phases: Vec<(bool, bool)> = tokenize
        .iter()
        .map(|call| {
            let failed = type_into_code(*call);
            (failed.main_error, failed.follow_up_failed)
        })
        .collect();
    eprintln!(
        "typing calls={:?} tokenize at={tokenize:?} phases(main,follow_up)={phases:?} loro_changes={:?} highlights_without_id={}",
        run.calls, run.loro_changes, run.highlights_without_id
    );
    assert_eq!(phases, vec![(true, false)]);
    // The cause, as in Source: the new highlight nodes get their ids inside the typing update,
    // so the typing is one change and no follow-up round re-dirties the code block.
    assert_eq!(run.highlights_without_id, 0);
    assert_eq!(run.loro_changes, Some(1));
}

/// Records each reported model error's code-tokenizer cause with its view index.
#[derive(Default)]
struct ThrownReports(std::sync::Mutex<Vec<(usize, Option<u32>)>>);
impl ReportedModelErrorObserver for ThrownReports {
    fn reported(&self, error: &lexical_model::Error, view_index: usize) {
        let cause = match error {
            lexical_model::Error::Extension(cause) => {
                match cause.downcast_ref::<CodeTokenError>() {
                    Some(CodeTokenError::Thrown { cause }) => Some(*cause),
                    _ => None,
                }
            }
            _ => None,
        };
        self.0.lock().unwrap().push((view_index, cause));
    }
}

// The one follow-up tokenize left (an id-less SetState): its throw reaches the reported-error
// observer with the original cause, at the index of the FollowUpFailed effect, as a main-update
// throw does at its error effect.
#[test]
fn a_follow_up_tokenizer_throw_reaches_the_observer_with_its_cause() {
    let provider = Arc::new(ThrowAt {
        calls: AtomicUsize::new(0),
        throw_at: 2,
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
    let reports = Arc::new(ThrownReports::default());
    // As observe_reported_model_errors installs it: follow-up causes reach the observer through
    // the follow-up capture.
    let capture = Arc::new(super::reported_errors::Capture::default());
    local.core.observe_follow_up_errors(capture.clone());
    local.follow_up_errors = Some(capture);
    local.reported_errors = Some(reports.clone());
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
    let follow_up = view
        .iter()
        .position(|effect| matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. })));
    assert!(follow_up.is_some(), "the throw failed a follow-up");
    assert!(
        !view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_))),
        "not a main-update error"
    );
    assert_eq!(
        *reports.0.lock().unwrap(),
        vec![(follow_up.unwrap(), Some(2))]
    );
}
