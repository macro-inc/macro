//! AI-edit undo grouping is the editor's history rule, as in Source: the app
//! groups AI ops by registerLoroHistory's 400 ms window (strict: 399 ms merges,
//! 400 ms splits; Lexical's getMergeAction and Loro's mergeInterval agree), not
//! one step per edit. Source rows: apps/web applyAiOps.source-controls.test.ts
//! ('around the 400 ms window', 'Loro mergeInterval alone').
use super::*;
use serde_json::json;
use std::sync::atomic::AtomicI64;

/// Far beyond the history delay window.
const SLOW_OP_GAP_MS: u64 = 5_000;
/// The app editor's history delay: `history(400, loroManager)`.
const SOURCE_DELAY_MS: u64 = 400;

fn now(time: u64) -> Now {
    Now {
        mono: doc_sync_core::Millis(time),
        wall: doc_sync_core::UnixMillis(i64::try_from(time).expect("test time")),
    }
}

fn surface() -> (EditorSurface, LoroDoc, Vec<ViewEffect>) {
    let config = crate::application::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let mut surface = EditorSurface::new(config, 7, now(0)).expect("actual Macro session surface");
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    let mut view = Vec::new();
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("initialize");
    let paragraph = |id: &str, text: &str| json!({"type":"paragraph","$":{"id":id},"children":[{"type":"text","text":text}]});
    surface
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(json!({"root":{"type":"root","children":[
                    paragraph("alphaId1", "Alpha beta gamma"),
                    paragraph("secondId", "Second line"),
                ]}}))
                .expect("seed"),
                tags: TagSet::default(),
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("seed loads");
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::ClearHistory,
                selection: ViewSelection::KeepModel,
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("clear bootstrap history");
    (surface, doc, view)
}

#[test]
fn ai_ops_group_by_the_400_ms_history_window_like_source() {
    let mut rows = Vec::new();
    for gap in [0, SOURCE_DELAY_MS - 1, SOURCE_DELAY_MS, 500] {
        let (mut surface, doc, mut view) = surface();
        let before = surface.state().to_json().expect("before");
        op(
            &mut surface,
            &doc,
            &mut view,
            1_000,
            1,
            json!({"kind":"setText","node":"alphaId1","text":"Omega beta gamma"}),
        );
        let after_first = surface.state().to_json().expect("after first");
        op(
            &mut surface,
            &doc,
            &mut view,
            1_000 + gap,
            2,
            json!({"kind":"setText","node":"secondId","text":"Final line"}),
        );
        assert_eq!(
            &*surface.state().root_text_content(),
            "Omega beta gamma\n\nFinal line"
        );
        surface
            .apply(&doc, Input::Undo, now(20_000), Access::Edit, &mut view)
            .expect("undo");
        let undo1 = surface.state().to_json().expect("undo");
        let merged = if undo1 == before {
            true
        } else {
            assert_eq!(undo1, after_first, "gap {gap}: one undo reverts one op");
            false
        };
        rows.push((gap, merged));
    }
    // Source: 0 and 399 merge into one undo step; 400 and 500 are two.
    assert_eq!(
        rows,
        vec![(0, true), (399, true), (400, false), (500, false)]
    );
}

fn op(
    surface: &mut EditorSurface,
    doc: &LoroDoc,
    view: &mut Vec<ViewEffect>,
    time: u64,
    invocation: u32,
    op: serde_json::Value,
) {
    let command = macro_document_model::surface::decode_command(
        "group-c.ai-op",
        &json!({"op":op,"invocation":invocation}).to_string(),
        0,
        None,
    )
    .expect("decode AI op")
    .expect("registered AI op");
    surface
        .apply(
            doc,
            Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            },
            now(time),
            Access::Edit,
            view,
        )
        .expect("apply AI op");
}

fn refusals(view: &[ViewEffect]) -> Vec<serde_json::Value> {
    view.iter()
        .filter_map(|effect| match effect {
            ViewEffect::Editor(Effect::PluginEvent(event))
                if event.name() == "group-c.ai-op-refused" =>
            {
                macro_document_model::surface::event_payload(event).expect("encode")
            }
            _ => None,
        })
        .collect()
}

/// A refusal mid-edit is event-only: no document, selection, undo step or
/// history clock change, and exactly one typed cause in that input's output.
#[test]
fn a_refused_op_mid_edit_changes_no_history() {
    let (mut surface, doc, mut view) = surface();
    let before = surface.state().to_json().expect("before");
    op(
        &mut surface,
        &doc,
        &mut view,
        1_000,
        1,
        json!({"kind":"setText","node":"alphaId1","text":"Omega beta gamma"}),
    );
    let after_first = surface.state().to_json().expect("after first");
    assert!(refusals(&view).is_empty());

    // Select everything, then refuse an op far from the first.
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::SelectAll(None),
                selection: ViewSelection::KeepModel,
            },
            now(1_000 + SLOW_OP_GAP_MS),
            Access::Edit,
            &mut view,
        )
        .expect("select all");
    let selection = surface.state().selection().cloned();
    assert!(selection.is_some());
    view.clear();
    op(
        &mut surface,
        &doc,
        &mut view,
        1_000 + 2 * SLOW_OP_GAP_MS,
        2,
        json!({"kind":"replaceText","node":"secondId","find":"absent","to":"x","scope":{"kind":"all"}}),
    );
    assert_eq!(
        refusals(&view),
        vec![json!({"cause":"findMissed","invocation":2})]
    );
    assert_eq!(surface.state().to_json().expect("refused"), after_first);
    assert_eq!(surface.state().selection().cloned(), selection);

    // An op 50 ms after the refusal: had the refusal moved the history
    // clock, this op would fall inside the merge window and join the first
    // op's step, so one undo would return to `before`.
    view.clear();
    op(
        &mut surface,
        &doc,
        &mut view,
        1_000 + 2 * SLOW_OP_GAP_MS + 50,
        3,
        json!({"kind":"setText","node":"secondId","text":"Final line"}),
    );
    assert!(refusals(&view).is_empty());
    surface
        .apply(&doc, Input::Undo, now(40_000), Access::Edit, &mut view)
        .expect("undo the last op");
    assert_eq!(surface.state().to_json().expect("one undo"), after_first);
    surface
        .apply(&doc, Input::Undo, now(41_000), Access::Edit, &mut view)
        .expect("undo the first op");
    assert_eq!(surface.state().to_json().expect("two undos"), before);
}
