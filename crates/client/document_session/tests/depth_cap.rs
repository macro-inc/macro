#![cfg(feature = "application")]
//! A remote update nested past the model's depth cap is refused without corrupting the
//! session, and a later update that brings the tree back under the cap recovers it.
use doc_sync_core::{Access, Millis, Now, UnixMillis};
use document_session::{
    EditorConfig, EditorSurface, Surface, SurfaceConfig, ViewEffect, application_editor_config,
};
use lexical_model::*;
use macro_document_model::EditorType;
use serde_json::json;
use std::sync::{Arc, atomic::AtomicI64};

fn at(ms: u32) -> Now {
    Now {
        mono: Millis(u64::from(ms)),
        wall: UnixMillis(i64::from(ms)),
    }
}

fn type_text(
    surface: &mut EditorSurface,
    doc: &loro::LoroDoc,
    ms: u32,
) -> (
    Result<bool, document_session::SessionError>,
    Vec<ViewEffect>,
) {
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
    let mut effects = Vec::new();
    let result = Surface::local(
        surface,
        doc,
        document_session::SessionInput::Editor(Input::Command {
            command: Command::InsertText("x".into()),
            selection: ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            },
        }),
        document_session::LocalInputContext::new(at(ms), Access::Edit, true),
        &mut effects,
        None,
    );
    (result, effects)
}

fn kinds(effects: &[ViewEffect]) -> Vec<String> {
    effects
        .iter()
        .map(|effect| match effect {
            ViewEffect::Error(error) => format!("Error({error})"),
            ViewEffect::Initialize(_) => "Initialize".to_owned(),
            ViewEffect::Diff(_) => "Diff".to_owned(),
            _ => "Other".to_owned(),
        })
        .collect()
}

#[test]
fn a_remote_update_past_the_depth_cap_is_refused_and_a_later_undo_recovers()
-> Result<(), Box<dyn std::error::Error>> {
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(|| -> Result<(), String> {
            let run = || -> Result<(), Box<dyn std::error::Error>> {
                let stored = json!({ "root": {
                    "type":"root", "version":1, "format":"", "indent":0, "direction":null,
                    "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
                        {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
                         "textFormat":0,"textStyle":"","$":{"id":"Ts1gplV5"},"children":[]}
                    ]
                }});
                let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
                let doc = lexical_loro::new_doc(50)?;
                doc.import(&snapshot)?;
                let mut config = application_editor_config(
                    EditorConfig::default(),
                    Arc::new(AtomicI64::new(0)),
                    EditorType::MarkdownSync,
                );
                config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
                let mut surface = <EditorSurface as Surface>::construct(
                    SurfaceConfig::Editor(config),
                    50,
                    at(0),
                )?;
                Surface::init(&mut surface, &doc, at(0), Access::Edit, &mut Vec::new())?;

                let peer = lexical_loro::fork_doc(&doc, 51)?;
                let before = peer.oplog_vv();
                let root_children = match peer.get_map("root").get("children") {
                    Some(loro::ValueOrContainer::Container(loro::Container::MovableList(l))) => l,
                    _ => return Err("root children".into()),
                };
                let mut list = root_children.clone();
                for _ in 0..=MAX_NODE_DEPTH {
                    let map = list.insert_container(0, loro::LoroMap::new())?;
                    map.insert("type", "paragraph")?;
                    map.insert("version", 1)?;
                    map.insert("format", "")?;
                    map.insert("indent", 0)?;
                    list = map.insert_container("children", loro::LoroMovableList::new())?;
                }
                peer.commit();
                doc.import(&peer.export(loro::ExportMode::updates(&before))?)?;
                let imported = doc.oplog_vv();
                let mut effects = Vec::new();
                let remote =
                    Surface::remote(&mut surface, &doc, at(1000), Access::Edit, &mut effects);
                // The refused import surfaces one error to the host and writes nothing.
                assert!(
                    remote.as_ref().is_err_and(|error| error
                        .to_string()
                        .contains("nesting deeper than 512 levels")),
                    "{:?}",
                    remote.as_ref().err().map(ToString::to_string)
                );
                assert_eq!(kinds(&effects), ["Error(nesting deeper than 512 levels)"]);
                assert_eq!(doc.oplog_vv(), imported);
                let (typed, effects) = type_text(&mut surface, &doc, 2000);
                // A keystroke over the refused state is refused too, not written.
                assert!(typed.is_err_and(|error| error.to_string().contains("nesting deeper")));
                assert!(effects.is_empty());
                assert_eq!(doc.oplog_vv(), imported);

                let before = peer.oplog_vv();
                root_children.delete(0, 1)?;
                peer.commit();
                doc.import(&peer.export(loro::ExportMode::updates(&before))?)?;
                let mut effects = Vec::new();
                let recovered =
                    Surface::remote(&mut surface, &doc, at(3000), Access::Edit, &mut effects);
                // The peer's undo brings the tree back under the cap: the next import
                // resyncs (a fresh Initialize) without a reopen, and typing writes again.
                assert!(
                    recovered.is_ok(),
                    "{:?}",
                    recovered.err().map(|e| e.to_string())
                );
                assert!(kinds(&effects).iter().any(|kind| kind == "Initialize"));
                let synced = doc.oplog_vv();
                let (typed, _) = type_text(&mut surface, &doc, 4000);
                assert!(typed.is_ok());
                assert_ne!(doc.oplog_vv(), synced);
                Ok(())
            };
            run().map_err(|error| error.to_string())
        })
        .expect("spawn")
        .join()
        .expect("no stack overflow")
        .map_err(Into::into)
}

// A peer moves a valid 512-deep chain under another top-level block. Loro cannot reparent
// containers, so the move is a delete and a recreate that reuses the chain's $.ids; the
// session refuses it like any too-deep update.
#[test]
fn a_remote_move_that_pushes_a_valid_chain_past_the_cap_is_refused()
-> Result<(), Box<dyn std::error::Error>> {
    std::thread::Builder::new()
        .stack_size(64 << 20)
        .spawn(|| -> Result<(), String> {
            let run = || -> Result<(), Box<dyn std::error::Error>> {
                let stored = json!({ "root": {
                    "type":"root", "version":1, "format":"", "indent":0, "direction":null,
                    "$":{"id":"root","documentMetadata":{"version":11}}, "children":[
                        {"type":"paragraph","version":1,"format":"","indent":0,"direction":null,
                         "textFormat":0,"textStyle":"","$":{"id":"hostHost"},"children":[]}
                    ]
                }});
                let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(&stored, None)?;
                let doc = lexical_loro::new_doc(50)?;
                doc.import(&snapshot)?;
                let mut config = application_editor_config(
                    EditorConfig::default(),
                    Arc::new(AtomicI64::new(0)),
                    EditorType::MarkdownSync,
                );
                config.policy = &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
                let mut surface = <EditorSurface as Surface>::construct(
                    SurfaceConfig::Editor(config),
                    50,
                    at(0),
                )?;
                Surface::init(&mut surface, &doc, at(0), Access::Edit, &mut Vec::new())?;
                let peer = lexical_loro::fork_doc(&doc, 51)?;
                let children = |map: &loro::LoroMap| match map.get("children") {
                    Some(loro::ValueOrContainer::Container(loro::Container::MovableList(list))) => {
                        Ok(list)
                    }
                    _ => Err("children"),
                };
                let chain_into = |list: &loro::LoroMovableList,
                                  index: usize|
                 -> Result<(), Box<dyn std::error::Error>> {
                    let mut list = list.clone();
                    let mut index = index;
                    for level in 0..MAX_NODE_DEPTH {
                        let map = list.insert_container(index, loro::LoroMap::new())?;
                        map.insert("type", "paragraph")?;
                        map.insert("version", 1)?;
                        map.insert("format", "")?;
                        map.insert("indent", 0)?;
                        let state = map.insert_container("$", loro::LoroMap::new())?;
                        state.insert("id", format!("c{level:07}"))?;
                        list = map.insert_container("children", loro::LoroMovableList::new())?;
                        index = 0;
                    }
                    Ok(())
                };
                let root = peer.get_map("root");
                let before = peer.oplog_vv();
                chain_into(&children(&root)?, 1)?;
                peer.commit();
                doc.import(&peer.export(loro::ExportMode::updates(&before))?)?;
                let mut effects = Vec::new();
                Surface::remote(&mut surface, &doc, at(1000), Access::Edit, &mut effects)?;
                assert!(!kinds(&effects).iter().any(|kind| kind.starts_with("Error")));
                let before = peer.oplog_vv();
                let root_list = children(&root)?;
                root_list.delete(1, 1)?;
                let host = match root_list.get(0) {
                    Some(loro::ValueOrContainer::Container(loro::Container::Map(map))) => map,
                    _ => return Err("host".into()),
                };
                chain_into(&children(&host)?, 0)?;
                peer.commit();
                doc.import(&peer.export(loro::ExportMode::updates(&before))?)?;
                let imported = doc.oplog_vv();
                let mut effects = Vec::new();
                let moved =
                    Surface::remote(&mut surface, &doc, at(2000), Access::Edit, &mut effects);
                assert!(
                    moved.as_ref().is_err_and(|error| error
                        .to_string()
                        .contains("nesting deeper than 512 levels")),
                    "{:?}",
                    moved.as_ref().err().map(ToString::to_string)
                );
                assert_eq!(doc.oplog_vv(), imported);
                Ok(())
            };
            run().map_err(|error| error.to_string())
        })
        .expect("spawn")
        .join()
        .expect("no stack overflow")
        .map_err(Into::into)
}
