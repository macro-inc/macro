//! Root own fields are ignored by Source reconcile; only a later local write syncs them.
use super::root_id_test::{ABSENT_ROOT, id_of, model_root_state, open, seeded, stored_root_state};
use super::*;

fn now() -> Now {
    Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    }
}

#[test]
fn remote_root_id_changes_preserve_the_live_id_until_a_local_write() {
    for incoming in [Some("foreignRoot"), None] {
        let fixture = ABSENT_ROOT.replacen(
            r#""type":"root","#,
            r#""type":"root","$":{"id":"ROOTid01"},"#,
            1,
        );
        let doc = seeded(&fixture, 8);
        let mut surface = open(&doc, 8, Access::Edit);
        let remote = lexical_loro::new_doc(9).expect("remote peer");
        remote
            .import(&doc.export(loro::ExportMode::Snapshot).expect("snapshot"))
            .expect("seed");
        let Some(loro::ValueOrContainer::Container(loro::Container::Map(state))) =
            remote.get_map("root").get("$")
        else {
            panic!("stored root state");
        };
        if let Some(id) = incoming {
            state.insert("id", id).expect("foreign id");
        } else {
            state.delete("id").expect("deleted id");
        }
        remote.commit();
        doc.import(
            &remote
                .export(loro::ExportMode::updates(&doc.oplog_vv()))
                .expect("updates"),
        )
        .expect("real remote root field update");
        let imported = doc.oplog_vv();
        let mut effects = Vec::new();
        let changed = surface
            .remote_pending(&doc, now(), Access::Edit, &mut effects, false)
            .expect("reconcile");
        assert_eq!(
            id_of(&model_root_state(&surface)),
            "ROOTid01",
            "Source ignores incoming root own fields"
        );
        assert_eq!(stored_root_state(&doc)["id"].as_str(), incoming);
        assert_eq!(
            doc.oplog_vv(),
            imported,
            "present live ID means no fix-up write"
        );
        assert!(!changed);
        assert!(
            !effects.iter().any(|effect| matches!(effect,
                ViewEffect::CommitTags(tags) if tags.iter().any(|tag| tag == COLLAB_SELECTION_TAG)
            )),
            "the present-ID follow-up is an empty apply, not a new publication"
        );
        surface
            .projection
            .as_ref()
            .expect("projection")
            .check(&doc, surface.state())
            .expect("strict comparison respects retained storage slot");
        let view = surface.state().view();
        let paragraph = view.children_keys(NodeKey::ROOT).expect("paragraph")[0];
        let text = view.children_keys(paragraph).expect("text")[0];
        let point = Point::text(text, Utf16Offset(5));
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("!".into()),
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                },
                now(),
                Access::Edit,
                &mut effects,
            )
            .expect("next real local write");
        assert_eq!(&*surface.state().root_text_content(), "hello!");
        assert_eq!(id_of(&model_root_state(&surface)), "ROOTid01");
        assert_eq!(
            id_of(&stored_root_state(&doc)),
            "ROOTid01",
            "the next local sync writes the retained model ID back, as Source does"
        );
    }
}

#[test]
fn the_first_undo_after_an_idless_root_import_restores_the_local_edit() {
    let fixture = ABSENT_ROOT.replacen(
        r#""type":"root","#,
        r#""type":"root","$":{"id":"ROOTid01"},"#,
        1,
    );
    let doc = seeded(&fixture, 8);
    let mut surface = open(&doc, 8, Access::Edit);
    let mut effects = Vec::new();
    surface
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(serde_json::json!({"root":
                    serde_json::from_str::<serde_json::Value>(ABSENT_ROOT).expect("root")
                }))
                .expect("id-less state"),
                tags: TagSet::default(),
            },
            now(),
            Access::Edit,
            &mut effects,
        )
        .expect("raw SetState");
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::ClearHistory,
                selection: ViewSelection::KeepModel,
            },
            now(),
            Access::Edit,
            &mut effects,
        )
        .expect("clear setup history");
    let remote = lexical_loro::new_doc(9).expect("remote peer");
    remote
        .import(&doc.export(loro::ExportMode::Snapshot).expect("snapshot"))
        .expect("seed");
    let Some(loro::ValueOrContainer::Container(loro::Container::MovableList(children))) =
        remote.get_map("root").get("children")
    else {
        panic!("paragraphs");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(paragraph))) = children.get(0)
    else {
        panic!("paragraph");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::MovableList(children))) =
        paragraph.get("children")
    else {
        panic!("leaves");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Map(leaf))) = children.get(0)
    else {
        panic!("leaf");
    };
    let Some(loro::ValueOrContainer::Container(loro::Container::Text(text))) = leaf.get("text")
    else {
        panic!("text");
    };
    text.insert(5, "!").expect("remote edit");
    remote.commit();
    doc.import(
        &remote
            .export(loro::ExportMode::updates(&doc.oplog_vv()))
            .expect("updates"),
    )
    .expect("import");
    surface
        .remote_pending(&doc, now(), Access::Edit, &mut effects, false)
        .expect("reconcile");
    assert_eq!(&*surface.state().root_text_content(), "hello!");
    let id = id_of(&model_root_state(&surface));
    assert_eq!(
        id.len(),
        8,
        "the real remote import minted the missing root ID"
    );
    assert_eq!(id_of(&stored_root_state(&doc)), id);
    let view = surface.state().view();
    let paragraph = view.children_keys(NodeKey::ROOT).expect("paragraph")[0];
    let text = view.children_keys(paragraph).expect("text")[0];
    let point = Point::text(text, Utf16Offset(6));
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("?".into()),
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            now(),
            Access::Edit,
            &mut effects,
        )
        .expect("local edit");
    assert_eq!(&*surface.state().root_text_content(), "hello!?");
    surface
        .apply(&doc, Input::Undo, now(), Access::Edit, &mut effects)
        .expect("first undo");
    assert_eq!(
        &*surface.state().root_text_content(),
        "hello!",
        "C-ROOT-ID-FIRST-UNDO-01"
    );
    assert_eq!(id_of(&model_root_state(&surface)), id);
    assert!(!surface.undo.as_ref().expect("history").can_undo());
    assert!(surface.undo.as_ref().expect("history").can_redo());
    surface
        .apply(&doc, Input::Redo, now(), Access::Edit, &mut effects)
        .expect("redo");
    assert_eq!(&*surface.state().root_text_content(), "hello!?");
    assert_eq!(id_of(&model_root_state(&surface)), id);
}
