//! One AI edit is one undo step however slowly its ops arrive: every op after
//! the first carries an explicit history merge (Source applies all of an edit's
//! ops in one synchronous loop, so its undo never sees a gap between them).
use super::*;
use serde_json::json;
use std::sync::atomic::AtomicI64;

/// Far beyond the history delay window.
const SLOW_OP_GAP_MS: u64 = 5_000;

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

fn set_text(
    surface: &mut EditorSurface,
    doc: &LoroDoc,
    view: &mut Vec<ViewEffect>,
    time: u64,
    node: &str,
    text: &str,
    merge: bool,
) {
    let command = macro_document_model::surface::decode_command(
        "group-c.ai-op",
        &json!({"op":{"kind":"setText","node":node,"text":text},"merge":merge}).to_string(),
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

#[test]
fn a_slow_ai_edit_still_undoes_and_redoes_as_one_step() {
    let (mut surface, doc, mut view) = surface();
    let before = surface.state().to_json().expect("before");
    set_text(
        &mut surface,
        &doc,
        &mut view,
        1_000,
        "alphaId1",
        "Omega beta gamma",
        false,
    );
    set_text(
        &mut surface,
        &doc,
        &mut view,
        1_000 + SLOW_OP_GAP_MS,
        "secondId",
        "Final line",
        true,
    );
    let after = surface.state().to_json().expect("after");
    assert_eq!(
        &*surface.state().root_text_content(),
        "Omega beta gamma\n\nFinal line"
    );
    surface
        .apply(&doc, Input::Undo, now(20_000), Access::Edit, &mut view)
        .expect("undo");
    assert_eq!(surface.state().to_json().expect("undo"), before);
    surface
        .apply(&doc, Input::Redo, now(21_000), Access::Edit, &mut view)
        .expect("redo");
    assert_eq!(surface.state().to_json().expect("redo"), after);
}

#[test]
fn without_the_merge_flag_slow_ops_are_separate_undo_steps() {
    let (mut surface, doc, mut view) = surface();
    set_text(
        &mut surface,
        &doc,
        &mut view,
        1_000,
        "alphaId1",
        "Omega beta gamma",
        false,
    );
    set_text(
        &mut surface,
        &doc,
        &mut view,
        1_000 + SLOW_OP_GAP_MS,
        "secondId",
        "Final line",
        false,
    );
    surface
        .apply(&doc, Input::Undo, now(20_000), Access::Edit, &mut view)
        .expect("undo");
    // The control: only the later op is undone, so the merge flag is what joins them.
    assert_eq!(
        &*surface.state().root_text_content(),
        "Omega beta gamma\n\nSecond line"
    );
}
