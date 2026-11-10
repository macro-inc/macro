use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

#[test]
fn snapshot_delete_preserves_source_boundaries() -> Result<(), Error> {
    for boundary in ["next", "previous", "empty-parent"] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        let ((parent, snapshot, text), _) = editor.update(|tx| {
            let parent = tx.create(Paragraph {})?;
            let snapshot = tx.create(SnapshotNode {
                document_id: Maybe::Value("snapshot-document".into()),
                document_name: Maybe::Value("Snapshot".into()),
                block_name: Maybe::Value("md".into()),
                content: Maybe::Value("Saved text".into()),
                snapshot_date: "2020-01-01T00:00:00.000Z".into(),
                ..SnapshotNode::default()
            })?;
            let text = tx.create_text("Keep")?;
            match boundary {
                "next" => tx.append(parent, &[snapshot.key(), text.key()])?,
                "previous" => tx.append(parent, &[text.key(), snapshot.key()])?,
                _ => tx.append(parent, &[snapshot.key()])?,
            }
            tx.append(NodeKey::ROOT, &[parent.key()])?;
            Ok((parent.key(), snapshot.key(), text.key()))
        })?;
        let command = decode_command(
            "group-b.snapshot-delete",
            &serde_json::json!({ "key": snapshot.index() }).to_string(),
            snapshot.generation(),
            None,
        )?
        .expect("typed snapshot action");
        let (handled, _) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        let state = editor.state();
        assert!(!state.view().is_attached(snapshot));
        let Some(Selection::Range(selection)) = state.selection() else {
            panic!("restored Source range");
        };
        let expected_key = if boundary == "empty-parent" {
            parent
        } else {
            text
        };
        let expected_offset = if boundary == "previous" { 4 } else { 0 };
        assert_eq!(selection.anchor.key(), expected_key);
        assert_eq!(selection.anchor.offset(), expected_offset);
        assert_eq!(selection.anchor, selection.focus);
    }
    Ok(())
}

#[test]
fn snapshot_delete_yields_for_other_types_missing_and_stale_keys() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((text, snapshot), _) = editor.update(|tx| {
        let parent = tx.create(Paragraph {})?;
        let text = tx.create_text("Keep")?;
        let snapshot = tx.create(SnapshotNode::default())?;
        tx.append(parent, &[text.key(), snapshot.key()])?;
        tx.append(NodeKey::ROOT, &[parent.key()])?;
        Ok((text.key(), snapshot.key()))
    })?;
    let before = editor.state().to_json()?;
    let selection = editor.state().selection().cloned();
    for (index, generation) in [
        (text.index(), text.generation()),
        (u32::MAX, snapshot.generation()),
        (snapshot.index(), snapshot.generation().wrapping_add(1)),
    ] {
        let command = decode_command(
            "group-b.snapshot-delete",
            &serde_json::json!({ "key": index }).to_string(),
            generation,
            None,
        )?
        .expect("typed snapshot action");
        let (handled, _) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::No);
        assert!(editor.state().view().is_attached(text));
        assert!(editor.state().view().is_attached(snapshot));
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(editor.state().selection(), selection.as_ref());
    }
    Ok(())
}
