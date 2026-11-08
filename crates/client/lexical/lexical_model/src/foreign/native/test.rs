use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn native_super_skips_the_foreign_ancestor_chain_only_once_for_the_exact_node() -> Result<(), Error>
{
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn is_inline(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(true)
        }
    }
    let parent = Arc::new(AtomicUsize::new(0));
    let child = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-parent".into(),
            class_name: "NativeParent".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(parent.clone())),
        })
        .foreign_node(ForeignNodeType {
            type_name: "native-child".into(),
            class_name: "NativeChild".into(),
            kind: NodeKind::Element,
            extends: Some("native-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks(child.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let first = tx.create_foreign("native-child", SerializedNode::new())?;
    let second = tx.create_foreign("native-child", SerializedNode::new())?;
    child.store(0, Ordering::SeqCst);
    parent.store(0, Ordering::SeqCst);
    tx.with_foreign_native::<_, Error>(first, ForeignHook::IsInline, |tx| {
        assert!(tx.is_inline(second));
        assert!(!tx.is_inline(first));
        assert!(tx.is_inline(first));
        Ok(())
    })?;
    assert_eq!(child.load(Ordering::SeqCst), 2);
    assert_eq!(parent.load(Ordering::SeqCst), 0);
    assert!(tx.is_inline(first));
    assert_eq!(child.load(Ordering::SeqCst), 3);
    Ok(())
}

#[test]
fn native_super_append_keeps_nested_virtual_splice_and_same_hook_reentry() -> Result<(), Error> {
    struct Hooks {
        append: Arc<AtomicUsize>,
        splice: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {
        fn append(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: &[NodeKey],
        ) -> Override<Result<(), Error>> {
            self.append.fetch_add(1, Ordering::SeqCst);
            Override::Value(Ok(()))
        }
        fn splice(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            start: ChildIndex,
            delete: u32,
            nodes: &[NodeKey],
        ) -> Override<Result<(), Error>> {
            self.splice.fetch_add(1, Ordering::SeqCst);
            Override::Value((|| {
                // A consumed outer append scope must not suppress this append.
                tx.append(key, &[])?;
                tx.default_splice(key, start, delete, nodes)
            })())
        }
    }
    let append = Arc::new(AtomicUsize::new(0));
    let splice = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-block".into(),
            class_name: "NativeBlock".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                append: append.clone(),
                splice: splice.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let block = tx.create_foreign("native-block", SerializedNode::new())?;
    let text = tx.create_text("native body")?.key();
    append.store(0, Ordering::SeqCst);
    splice.store(0, Ordering::SeqCst);
    tx.with_foreign_native::<_, Error>(block, ForeignHook::Append, |tx| tx.append(block, &[text]))?;
    assert_eq!(append.load(Ordering::SeqCst), 1);
    assert_eq!(splice.load(Ordering::SeqCst), 1);
    assert_eq!(tx.children(block).collect::<Vec<_>>(), vec![text]);
    assert_eq!(tx.text_content(block), "native body");
    Ok(())
}

#[test]
fn native_super_scopes_restore_after_nested_reads_errors_and_unwinding() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn is_inline(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            Override::Value(true)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-scope".into(),
            class_name: "NativeScope".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("native-scope", SerializedNode::new())?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    tx.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |tx| {
        tx.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |tx| {
            assert!(!tx.is_inline(key));
            Ok(())
        })?;
        assert!(!snapshot.is_inline(key));
        assert!(tx.is_inline(key));
        Ok(())
    })?;
    assert!(snapshot.is_inline(key));
    let failed =
        tx.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |_| -> Result<(), Error> {
            Err(Error::Invariant("before dispatch"))
        });
    assert!(failed.is_err());
    assert!(tx.is_inline(key));
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = tx.with_foreign_native::<_, Error>(
            key,
            ForeignHook::IsInline,
            |_| -> Result<(), Error> {
                panic!("before dispatch");
            },
        );
    }));
    assert!(panic.is_err());
    assert!(tx.is_inline(key));
    assert!(
        tx.with_foreign_native::<_, Error>(key, ForeignHook::Import, |_| Ok(()))
            .is_err()
    );
    assert!(
        tx.with_foreign_native::<_, Error>(key, ForeignHook::AfterClone, |_| Ok(()))
            .is_err()
    );
    let pending = tx.suspend();
    let tx = editor.resume(pending)?;
    assert!(tx.is_inline(key));
    Ok(())
}

#[test]
fn native_super_json_update_keeps_nested_text_setter_dispatch() -> Result<(), Error> {
    struct Hooks {
        updates: Arc<AtomicUsize>,
        setters: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {
        fn update_from_json(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            json: &SerializedNode,
        ) -> Override<Result<(), Error>> {
            if self.updates.fetch_add(1, Ordering::SeqCst) != 0 {
                return Override::Value(Err(Error::Invariant("recursive native-super update")));
            }
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::UpdateFromJson, |tx| {
                    tx.update_from_json(key, json)
                }),
            )
        }
        fn coerce_text_content(
            &self,
            _: NodeView<'_>,
            _: &ForeignData,
            requested: &str,
        ) -> Override<Result<String, Error>> {
            self.setters.fetch_add(1, Ordering::SeqCst);
            Override::Value(Ok(requested.to_uppercase()))
        }
    }
    let updates = Arc::new(AtomicUsize::new(0));
    let setters = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-json".into(),
            class_name: "NativeJson".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                updates: updates.clone(),
                setters: setters.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("native-json", SerializedNode::new())?;
    updates.store(0, Ordering::SeqCst);
    setters.store(0, Ordering::SeqCst);
    let json = serde_json::from_str(
        r#"{"text":"nested","format":1,"style":"","detail":0,"mode":"normal"}"#,
    )?;
    tx.update_from_json(key, &json)?;
    assert_eq!(updates.load(Ordering::SeqCst), 1);
    assert_eq!(setters.load(Ordering::SeqCst), 1);
    assert_eq!(tx.text_content(key), "NESTED");
    assert_eq!(tx.text_data(key)?.format, TextFormat::BOLD);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn an_owned_capture_on_another_thread_cannot_consume_native_super() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn is_inline(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            Override::Value(true)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-thread".into(),
            class_name: "NativeThread".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("native-thread", SerializedNode::new())?;
    tx.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |tx| {
        let capture = tx.view().snapshot_for_foreign_read()?;
        assert!(
            std::thread::spawn(move || capture.is_inline(key))
                .join()
                .expect("read thread")
        );
        assert!(!tx.is_inline(key));
        Ok(())
    })?;
    assert!(tx.is_inline(key));
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn overlapping_read_peer_native_scopes_are_isolated_by_thread() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn is_inline(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            Override::Value(true)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "native-overlap".into(),
            class_name: "NativeOverlap".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("native-overlap", SerializedNode::new())?;
    tx.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |tx| {
        let ready = Arc::new(std::sync::Barrier::new(2));
        let release = Arc::new(std::sync::Barrier::new(2));
        let capture = tx.view().snapshot_for_foreign_read()?;
        let committed = tx.committed_state().clone();
        let peer_ready = ready.clone();
        let peer_release = release.clone();
        let reader = std::thread::spawn(move || {
            capture.with_read_transaction(&committed, |peer| {
                peer.with_foreign_native::<_, Error>(key, ForeignHook::IsInline, |peer| {
                    peer_ready.wait();
                    peer_release.wait();
                    Ok(peer.is_inline(key))
                })
            })
        });
        ready.wait();
        let native = tx.is_inline(key);
        release.wait();
        let peer_native = reader.join().expect("read peer")??;
        assert!(!native);
        assert!(!peer_native);
        Ok(())
    })?;
    assert!(tx.is_inline(key));
    Ok(())
}
