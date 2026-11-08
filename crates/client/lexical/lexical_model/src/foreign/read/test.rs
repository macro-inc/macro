use super::*;

#[test]
fn owned_read_keeps_pending_text_selection_composition_and_previous_selection() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("before")?.key();
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p])?;
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok(text)
    })?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_text_content("pending")?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.set_composition_key(Some(text))?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(snapshot.state().root_text_content().as_ref(), "pending");
    tx.text(text)?.set_text_content("after")?;
    tx.set_selection(None)?;
    tx.set_composition_key(None)?;
    assert_eq!(snapshot.text_content(text), "pending");
    assert_eq!(
        snapshot
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor
            .offset(),
        1
    );
    assert_eq!(
        snapshot
            .previous_selection()
            .and_then(Selection::as_range)
            .expect("previous range")
            .anchor
            .offset(),
        3
    );
    assert!(snapshot.is_composing(text));
    assert_eq!(tx.text_content(text), "after");
    assert!(tx.selection().is_none());
    assert_eq!(tx.composition_key(), None);
    tx.commit()?;
    assert_eq!(snapshot.text_content(text), "pending");
    assert_eq!(editor.state().view().text_content(text), "after");
    assert_eq!(editor.state().root_text_content().as_ref(), "after");
    Ok(())
}

#[test]
fn owned_read_materializes_the_current_native_projection_and_keeps_it_independent()
-> Result<(), Error> {
    #[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Counter {
        count: u32,
    }
    impl NodeType for Counter {
        const TYPE: &'static str = "counter";
        type Kind = ElementKind;
        impl_default_node!();
    }
    impl ElementNode for Counter {
        element_node_base!();
        fn is_inline(&self, _: ElementView<'_>) -> bool {
            self.count >= 7
        }
    }
    struct Hooks(Arc<std::sync::atomic::AtomicU32>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Override::Inherit
        }
    }
    let clones = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Counter>()
        .foreign_node(ForeignNodeType {
            type_name: "foreign-counter".into(),
            class_name: "ForeignCounter".into(),
            kind: NodeKind::Element,
            extends: Some("counter"),
            required_state: vec![],
            hooks: Arc::new(Hooks(clones.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("foreign-counter", SerializedNode::new())?;
    let snapshot = crate::foreign::projection::native(&mut tx, key, |_, tx| {
        tx.get_mut::<Counter>(key)?.count = 7;
        let snapshot = tx.view().snapshot_for_foreign_read()?;
        assert_eq!(clones.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(
            snapshot.foreign_data(key).expect("foreign").fields["count"],
            7
        );
        assert!(snapshot.is_inline(key));
        assert!(snapshot.get::<Counter>(key).is_none());
        tx.get_mut::<Counter>(key)?.count = 9;
        assert_eq!(
            snapshot.foreign_data(key).expect("foreign").fields["count"],
            7
        );
        Ok(snapshot)
    })?;
    assert_eq!(tx.foreign_data(key).expect("foreign").fields["count"], 9);
    tx.set_foreign_field(key, "count", serde_json::json!(11))?;
    assert_eq!(
        snapshot.foreign_data(key).expect("foreign").fields["count"],
        7
    );
    assert!(snapshot.is_inline(key));
    drop(tx);
    assert_eq!(
        snapshot.foreign_data(key).expect("foreign").fields["count"],
        7
    );
    Ok(())
}
