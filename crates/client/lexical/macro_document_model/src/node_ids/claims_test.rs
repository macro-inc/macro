use super::*;
use crate::{EditorType, surface};

fn editor() -> Editor {
    NodeIdPlugin::register(
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(crate::NodeClock(std::sync::Arc::new(|| 1234))),
        &["root", "paragraph", "text"],
        None,
        [3; 32],
    )
    .initial_state(
        serde_json::from_str(
            r#"{"root":{"type":"root","children":[
                {"type":"paragraph","$":{"id":"existing"},"children":[]}
            ]}}"#,
        )
        .expect("fixture"),
    )
    .build()
    .expect("surface")
}

/// Source's map.set by a later writer overrides the earlier owner: with a claim for the copy, the
/// dirty original regenerates in id_transform and the copy keeps the id.
#[test]
fn a_claim_overrides_the_mapping_so_the_claimant_keeps_the_id() {
    let mut editor = editor();
    let original = editor
        .state()
        .view()
        .children_keys(NodeKey::ROOT)
        .expect("root")[0];
    let (copy, _) = editor
        .update(|tx| {
            let copy = tx.create(Paragraph::default())?;
            tx.set_state(copy, &ID_STATE, Some("existing".into()))?;
            tx.append(NodeKey::ROOT, &[copy.key()])?;
            claim_id(tx, "existing", copy.key())?;
            tx.mark_dirty(original)?;
            Ok(copy.key())
        })
        .expect("update");
    let view = editor.state().view();
    assert_eq!(
        get_id(view, copy)
            .expect("copy id")
            .map(|id| id.as_str().to_owned()),
        Some("existing".to_owned())
    );
    let fresh = get_id(view, original).expect("original id").expect("an id");
    assert_ne!(fresh.as_str(), "existing");
}
