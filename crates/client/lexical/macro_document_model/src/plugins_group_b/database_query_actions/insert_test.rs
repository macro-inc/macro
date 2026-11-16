//! Empty scalar Query insertion observed from the actual Source slash action.
use crate::{EditorType, surface};
use lexical_model::*;
use serde_json::json;

const NAME: &str = "group-b.database-query-insert";

fn editor() -> Editor {
    surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
        .build()
        .expect("Macro surface")
}

const ORACLE: &str = include_str!("source-insert-oracle.json");

fn point_snapshot(view: StateRef<'_>, point: Point) -> Result<serde_json::Value, Error> {
    let mut key = point.key();
    let mut path = Vec::new();
    while key != NodeKey::ROOT {
        path.push(
            view.index_within_parent(key)
                .ok_or(Error::Invariant("Query caret index"))?
                .0,
        );
        key = view.parent_or_err(key)?;
    }
    path.reverse();
    Ok(
        json!({"path":path,"offset":point.offset(),"type":match point.point_type() {PointType::Text=>"text",PointType::Element=>"element"}}),
    )
}

#[test]
fn inserts_full_source_paragraph_and_caret_at_current_or_root_end() -> Result<(), Error> {
    let oracle: serde_json::Value = serde_json::from_str(ORACLE)?;
    for mode in ["caret", "no-selection"] {
        let mut editor = editor();
        let (paragraph, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("Before. After.")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            if mode == "caret" {
                tx.select_end(text)?;
                tx.set_text_node_range(text, Utf16Offset(8), text, Utf16Offset(8))?;
            } else {
                // Initial state and this committed state both have no selection:
                // insert_nodes_at_selection must use the root-end fallback.
                tx.set_selection(None)?;
            }
            Ok(p.key())
        })?;
        if mode == "no-selection" {
            assert!(editor.state().selection().is_none());
        }
        let command =
            surface::decode_command(NAME, "{}", editor.state().max_key().generation(), None)?
                .ok_or(Error::Invariant("Query insertion command is missing"))?;
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        let view = editor.state().view();
        // Whole paragraph, including exact node versions/defaults; no stripping or masking.
        let paragraph_json = serde_json::Value::Object(view.export_node(paragraph)?);
        assert_eq!(paragraph_json, oracle[mode]["json"]["root"]["children"][0]);
        assert_eq!(
            serde_json::Value::Object(view.export_node(NodeKey::ROOT)?)["children"],
            oracle[mode]["json"]["root"]["children"]
        );
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .ok_or(Error::Invariant("Query caret missing"))?;
        let selection = json!({"kind":"range","anchor":point_snapshot(view,range.anchor)?,"focus":point_snapshot(view,range.focus)?,"format":range.format.bits(),"style":range.style.to_string()});
        assert_eq!(selection, oracle[mode]["selection"]);
        assert_eq!(commit.tags, TagSet::default());
    }
    Ok(())
}

#[test]
fn insertion_payload_is_an_empty_object() -> Result<(), Error> {
    let editor = editor();
    let generation = editor.state().max_key().generation();
    for payload in [
        "[]",
        "null",
        "0",
        "\"query\"",
        "{\"queryId\":\"\"}",
        "{\"prompt\":\"ignored\"}",
    ] {
        assert!(
            surface::decode_command(NAME, payload, generation, None).is_err(),
            "{payload}"
        );
    }
    assert!(surface::decode_command(NAME, "{}", generation, None)?.is_some());
    Ok(())
}

#[test]
fn stale_internal_typed_insert_does_not_construct_or_mutate() -> Result<(), Error> {
    let mut editor = editor();
    let before = editor.state().view().export_node(NodeKey::ROOT)?;
    let allocated = editor.state().max_key();
    let generation = allocated
        .generation()
        .checked_add(1)
        .ok_or(Error::Invariant("fixture generation"))?;
    let command = surface::decode_command(NAME, "{}", generation, None)?
        .ok_or(Error::Invariant("Query insertion command is missing"))?;
    let (handled, _) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::No);
    assert_eq!(editor.state().max_key(), allocated);
    assert_eq!(editor.state().view().export_node(NodeKey::ROOT)?, before);
    // This private guard control is not the external Session stale-envelope contract.
    Ok(())
}
