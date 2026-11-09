use super::*;
use crate::*;
use std::sync::atomic::{AtomicBool, Ordering};

#[test]
fn nested_failures_are_first_wins_and_do_not_poison_a_catching_parent() -> Result<(), Error> {
    assert!(!ForeignReadOperation::is_active());
    assert!(ForeignReadOperation::defer(Error::Invariant("unscoped")).is_err());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let outer = ForeignReadOperation::begin()?;
    let before = tx.create_text("before")?.key();
    let inner = ForeignReadOperation::begin()?;
    ForeignReadOperation::defer(Error::Invariant("first"))?;
    ForeignReadOperation::defer(Error::Invariant("second"))?;
    assert!(ForeignReadOperation::begin().is_err());
    assert_eq!(
        tx.create_text("forbidden")
            .expect_err("blocked")
            .to_string(),
        "first"
    );
    let result: Result<(), Error> = inner.finish(Ok(()));
    assert_eq!(result.expect_err("first failure").to_string(), "first");
    ForeignReadOperation::check()?;
    assert_eq!(tx.view().text_content(before), "before");
    tx.create_text("after")?;
    outer.finish::<_, Error>(Ok(()))?;
    assert!(!ForeignReadOperation::is_active());
    assert!(ForeignReadOperation::defer(Error::Invariant("unscoped again")).is_err());
    ForeignReadOperation::check()?;
    Ok(())
}

#[test]
fn a_failed_lazy_root_read_does_not_publish_its_placeholder_memo() -> Result<(), Error> {
    struct Hooks(Arc<AtomicBool>);
    impl ForeignHooks for Hooks {
        fn text_content(&self, _: NodeView<'_>, _: &ForeignData) -> Override<String> {
            if self.0.load(Ordering::SeqCst) {
                ForeignReadOperation::defer(Error::Invariant("text threw")).expect("operation");
                Override::Value("placeholder".into())
            } else {
                Override::Value("real text".into())
            }
        }
    }
    let fail = Arc::new(AtomicBool::new(false));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "failure-decorator".into(),
            class_name: "FailureDecorator".into(),
            kind: NodeKind::Decorator,
            extends: None,
            required_state: vec![],
            hooks: Arc::new(Hooks(fail.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("failure-decorator", SerializedNode::new())?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    assert!(editor.state().root_text.get().is_none());
    fail.store(true, Ordering::SeqCst);
    let operation = ForeignReadOperation::begin()?;
    let text = editor.state().root_text_content();
    assert_eq!(
        operation
            .finish::<_, Error>(Ok(text))
            .expect_err("failed read")
            .to_string(),
        "text threw"
    );
    assert!(editor.state().root_text.get().is_none());
    fail.store(false, Ordering::SeqCst);
    let operation = ForeignReadOperation::begin()?;
    assert_eq!(
        operation
            .finish::<_, Error>(Ok(editor.state().root_text_content()))?
            .as_ref(),
        "real text"
    );
    assert_eq!(
        editor
            .state()
            .root_text
            .get()
            .expect("successful memo")
            .as_ref(),
        "real text"
    );
    Ok(())
}

#[test]
fn deferred_preparation_failures_stop_publication_and_read_peer_point_writes() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_text("text")?.key();
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    let operation = ForeignReadOperation::begin()?;
    snapshot.with_read_transaction(&committed, |peer| -> Result<(), Error> {
        ForeignReadOperation::defer(Error::Invariant("point read failed"))?;
        assert!(
            peer.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(3)))
                .is_err()
        );
        assert_eq!(peer.anchor()?.offset(), 1);
        Ok(())
    })??;
    assert!(operation.finish::<_, Error>(Ok(())).is_err());
    let operation = ForeignReadOperation::begin()?;
    let result = tx.commit_foreign(|_| -> Result<(), Error> {
        ForeignReadOperation::defer(Error::Invariant("preparation failed"))?;
        Ok(())
    });
    assert_eq!(
        operation
            .finish(result)
            .expect_err("no publication")
            .to_string(),
        "preparation failed"
    );
    assert!(
        editor
            .state()
            .view()
            .children(NodeKey::ROOT)
            .next()
            .is_none()
    );
    Ok(())
}

#[test]
fn a_failed_queued_body_leaves_later_bodies_queued_and_uncalled() -> Result<(), Error> {
    fn first(_: &mut Transaction<'_>) -> Result<(), Error> {
        ForeignReadOperation::defer(Error::Invariant("queued read failed"))
    }
    fn second(tx: &mut Transaction<'_>) -> Result<(), Error> {
        tx.create_text("second body")?;
        Ok(())
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.queue_update(first, UpdateOptions::default())?;
    tx.queue_update(second, UpdateOptions::default())?;
    let operation = ForeignReadOperation::begin()?;
    assert!(tx.drain_updates().is_err());
    assert_eq!(tx.nested.len(), 1);
    assert!(tx.dirty_leaves.is_empty());
    assert!(operation.finish::<_, Error>(Ok(())).is_err());
    let operation = ForeignReadOperation::begin()?;
    tx.drain_updates()?;
    assert!(tx.nested.is_empty());
    assert_eq!(tx.dirty_leaves.len(), 1);
    operation.finish::<_, Error>(Ok(()))?;
    Ok(())
}

#[test]
fn caught_nested_failure_restores_the_latest_native_projection_without_writeback()
-> Result<(), Error> {
    #[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Parent {
        label: String,
    }
    impl NodeType for Parent {
        const TYPE: &'static str = "failure-parent";
        type Kind = ElementKind;
        impl_default_node!();
    }
    impl ElementNode for Parent {
        element_node_base!();
    }
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Parent>()
        .foreign_node(ForeignNodeType {
            type_name: "failure-child".into(),
            class_name: "FailureChild".into(),
            kind: NodeKind::Element,
            extends: Some("failure-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "failure-child",
        serde_json::json!({"label":"initial"})
            .as_object()
            .expect("fields")
            .clone(),
    )?;
    let outer = ForeignReadOperation::begin()?;
    crate::foreign::projection::native(&mut tx, key, |_, tx| {
        tx.get_mut::<Parent>(key)?.label = "native before".into();
        let inner = ForeignReadOperation::begin()?;
        let nested = crate::foreign::projection::foreign(tx, |tx| -> Result<(), Error> {
            tx.set_foreign_field(key, "label", serde_json::json!("foreign before throw"))?;
            ForeignReadOperation::defer(Error::Invariant("nested read failed"))?;
            Ok(())
        });
        let result = inner.finish(nested.and_then(|result| result));
        assert_eq!(
            result.expect_err("nested failure").to_string(),
            "nested read failed"
        );
        assert_eq!(
            tx.view().get::<Parent>(key).expect("restored parent").label,
            "foreign before throw"
        );
        Ok(())
    })?;
    outer.finish::<_, Error>(Ok(()))?;
    assert_eq!(
        tx.view().foreign_data(key).expect("fields").fields["label"],
        "foreign before throw"
    );
    Ok(())
}

#[test]
fn failed_scopes_block_native_writes_only_on_the_invoking_thread() -> Result<(), Error> {
    let rendezvous = std::sync::Barrier::new(2);
    std::thread::scope(|threads| -> Result<(), Error> {
        let failed = threads.spawn(|| -> Result<(), Error> {
            let mut editor = Editor::builder(EditorMode::Headless)
                .build()
                .expect("editor");
            let scope = ForeignReadOperation::begin()?;
            ForeignReadOperation::defer(Error::Invariant("blocked callback"))?;
            rendezvous.wait();
            let blocked = editor.transaction().create_text("blocked").is_err();
            rendezvous.wait();
            assert!(blocked);
            assert!(scope.finish::<_, Error>(Ok(())).is_err());
            editor.transaction().create_text("recovered")?;
            Ok(())
        });
        let ordinary = threads.spawn(|| -> Result<(), Error> {
            let mut editor = Editor::builder(EditorMode::Headless)
                .build()
                .expect("editor");
            rendezvous.wait();
            let active = ForeignReadOperation::is_active();
            let created = editor.transaction().create_text("independent").map(|_| ());
            rendezvous.wait();
            assert!(!active);
            created?;
            Ok(())
        });
        failed.join().expect("failed-scope thread")?;
        ordinary.join().expect("ordinary thread")?;
        Ok(())
    })
}
