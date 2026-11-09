use crate::*;
use std::sync::{Arc, Mutex};

#[test]
fn lazy_previous_and_pending_text_caches_retain_current_callback_provenance() -> Result<(), Error> {
    struct Hooks {
        origin: Arc<Mutex<Option<(ForeignEditorIdentity, ForeignUpdateIdentity)>>>,
        observations: Arc<Mutex<Vec<(u32, bool)>>>,
    }
    impl ForeignHooks for Hooks {
        fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            if let Some((owner, update)) = self.origin.lock().expect("origin").clone() {
                let snapshot = node.state.snapshot_for_foreign_read().expect("capture");
                let indent = node.state.element_data(node.key).expect("element").indent;
                self.observations
                    .lock()
                    .expect("observations")
                    .push((indent, snapshot.matches_origin(&owner, &update)));
            }
            Override::Value(false)
        }
    }
    let origin = Arc::new(Mutex::new(None));
    let observations = Arc::new(Mutex::new(Vec::new()));
    let mut headless = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "cache-element".into(),
            class_name: "CacheElement".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                origin: origin.clone(),
                observations: observations.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = headless.transaction();
    let key = tx.create_foreign("cache-element", SerializedNode::new())?;
    tx.set_indent(key, 3)?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    assert!(headless.state.root_text.get().is_none());
    // An uncomputed previous memo is valid, including a state seeded from headless.
    let mut attached = headless.create_conformance_peer(EditorMode::ViewAttached)?;
    attached.state = headless.state.clone();
    let mut tx = attached.transaction();
    *origin.lock().expect("origin") =
        Some((tx.foreign_editor_identity(), tx.foreign_update_identity()));
    tx.set_indent(key, 4)?;
    tx.commit()?;
    let observed = observations.lock().expect("observations");
    assert!(
        observed.contains(&(3, true)),
        "previous graph was read: {observed:?}"
    );
    assert!(
        observed.contains(&(4, true)),
        "pending graph was read: {observed:?}"
    );
    assert!(observed.iter().all(|(_, matches)| *matches));
    assert!(headless.state.root_text.get().is_some());
    assert!(attached.state.root_text.get().is_some());
    Ok(())
}
