use super::*;
use lexical_model::{Editor, EditorMode, ForeignHooks, ForeignNodeType, NodeKey, NodeKind};
use std::sync::atomic::{AtomicBool, Ordering};

#[test]
fn snapshot_release_and_replacement_drop_foreign_owners_outside_the_lock() -> Result<()> {
    struct Hooks {
        bindings: Bindings,
        dropped_unlocked: Arc<AtomicBool>,
    }
    impl ForeignHooks for Hooks {}
    impl Drop for Hooks {
        fn drop(&mut self) {
            self.dropped_unlocked
                .store(self.bindings.0.try_lock().is_ok(), Ordering::SeqCst);
        }
    }
    // Each editor's registry is owned only by the pinned snapshot after the
    // editor drops. Releasing it must permit its callback owner to reenter.
    for operation in [
        "replace",
        "release",
        "release saved",
        "replace retired",
        "release retired",
    ] {
        let bindings = Bindings::default();
        let dropped_unlocked = Arc::new(AtomicBool::new(false));
        let editor = Editor::builder(EditorMode::Headless)
            .foreign_node(ForeignNodeType {
                type_name: "drop-paragraph".into(),
                class_name: "DropParagraph".into(),
                kind: NodeKind::Element,
                extends: Some("paragraph"),
                required_state: vec![],
                hooks: Arc::new(Hooks {
                    bindings: bindings.clone(),
                    dropped_unlocked: dropped_unlocked.clone(),
                }),
            })
            .build()
            .expect("editor");
        if operation == "release saved" {
            assert_eq!(bindings.save_state(editor.state().clone())?, 0);
        } else if operation.ends_with("retired") {
            bindings.pin_retired_record(
                0,
                0,
                NodeKey::ROOT,
                editor
                    .state()
                    .view()
                    .node_or_err(NodeKey::ROOT)?
                    .capture_for_foreign_read(),
            )?;
        } else {
            bindings.pin_state(0, editor.state().clone())?;
        }
        drop(editor);
        assert!(!dropped_unlocked.load(Ordering::SeqCst));
        match operation {
            "replace" => {
                let replacement = Editor::builder(EditorMode::Headless)
                    .build()
                    .expect("replacement");
                bindings.pin_state(0, replacement.state().clone())?;
            }
            "replace retired" => {
                let replacement = Editor::builder(EditorMode::Headless)
                    .build()
                    .expect("replacement");
                bindings.pin_retired_record(
                    0,
                    0,
                    NodeKey::ROOT,
                    replacement
                        .state()
                        .view()
                        .node_or_err(NodeKey::ROOT)?
                        .capture_for_foreign_read(),
                )?;
            }
            "release" | "release retired" => bindings.release_state(0)?,
            "release saved" => bindings.release_saved_state(0)?,
            _ => unreachable!(),
        }
        assert!(dropped_unlocked.load(Ordering::SeqCst), "{operation}");
    }
    Ok(())
}

#[test]
fn releasing_one_editors_version_keeps_the_other_editors_handle() -> Result<()> {
    let bindings = Bindings::default();
    let (first, _) =
        bindings.intern_handle("first".into(), 1, "node", &serde_json::json!({"editor":0}))?;
    let (second, _) =
        bindings.intern_handle("second".into(), 1, "node", &serde_json::json!({"editor":1}))?;
    let released = bindings.release_editor_identities(0, 1)?;
    assert!(released.contains(&first));
    assert!(!released.contains(&second));
    assert_eq!(bindings.identity("second")?, Some(second));
    Ok(())
}

#[test]
fn saved_snapshot_owners_include_editor_and_version() -> Result<()> {
    let bindings = Bindings::default();
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let first = bindings.published_editor_state(0, 1, editor.state())?;
    let second = bindings.published_editor_state(1, 1, editor.state())?;
    assert_ne!(first, second);
    assert_eq!(bindings.saved_owner(first)?, Some((0, 1)));
    assert_eq!(bindings.saved_owner(second)?, Some((1, 1)));
    bindings.release_saved_state(first)?;
    assert_eq!(bindings.saved_owner(first)?, None);
    assert_eq!(bindings.saved_owner(second)?, Some((1, 1)));
    Ok(())
}
