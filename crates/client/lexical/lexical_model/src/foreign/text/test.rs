use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[test]
fn mutable_text_content_override_owns_equal_requests_and_native_super_writes() -> Result<(), Error>
{
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn coerce_text_content(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            requested: &str,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CoerceTextContent, |tx| {
                    tx.set_foreign_field(key, "observed", serde_json::json!(requested))?;
                    tx.text(key)?.set_text_content(&requested.to_uppercase())?;
                    Ok(())
                }),
            )
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-text".into(),
            class_name: "MutableText".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-text", SerializedNode::new())?;
    tx.text(key)?.set_text_content("abc")?;
    tx.text(key)?.set_text_content("ABC")?;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(tx.text_content(key), "ABC");
    assert_eq!(
        tx.foreign_data(key).expect("foreign").fields["observed"],
        "ABC"
    );
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    snapshot.with_read_transaction(tx.committed_state(), |peer| {
        assert!(matches!(
            peer.text(key)?.set_text_content("forbidden"),
            Err(Error::ForeignReadOnly)
        ));
        Ok::<_, Error>(())
    })??;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    Ok(())
}

#[test]
fn mutable_detail_override_can_change_the_requested_value_without_an_outer_write()
-> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn coerce_detail(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            requested: TextDetail,
        ) -> Override<Result<(), Error>> {
            assert_eq!(requested, TextDetail::UNMERGEABLE);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CoerceDetail, |tx| {
                    tx.text(key)?.set_detail(TextDetail::DIRECTIONLESS)?;
                    Ok(())
                }),
            )
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-detail".into(),
            class_name: "MutableDetail".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-detail", SerializedNode::new())?;
    tx.text(key)?.set_detail(TextDetail::UNMERGEABLE)?;
    assert_eq!(tx.view().text_data(key)?.detail, TextDetail::DIRECTIONLESS);
    Ok(())
}

#[test]
fn mutable_format_override_preserves_nested_virtual_calls_to_other_setters() -> Result<(), Error> {
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn coerce_format(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            requested: TextFormat,
        ) -> Override<Result<(), Error>> {
            assert_eq!(requested, TextFormat::ITALIC);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CoerceFormat, |tx| {
                    tx.text(key)?.set_detail(TextDetail::DIRECTIONLESS)?;
                    tx.text(key)?.set_format(TextFormat::BOLD)?;
                    Ok(())
                }),
            )
        }
        fn coerce_detail(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            detail: TextDetail,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CoerceDetail, |tx| {
                    tx.text(key)?.set_detail(detail)?;
                    Ok(())
                }),
            )
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-format".into(),
            class_name: "MutableFormat".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-format", SerializedNode::new())?;
    tx.text(key)?.set_format(TextFormat::ITALIC)?;
    assert_eq!(tx.view().text_data(key)?.format, TextFormat::BOLD);
    assert_eq!(tx.view().text_data(key)?.detail, TextDetail::DIRECTIONLESS);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn mutable_mode_override_skips_or_rejects_without_applying_the_requested_mode() -> Result<(), Error>
{
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn coerce_mode(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            _: TextMode,
        ) -> Override<Result<(), Error>> {
            match self.0.fetch_add(1, Ordering::SeqCst) {
                0 => Override::Value(tx.with_foreign_native(key, ForeignHook::CoerceMode, |tx| {
                    tx.text(key)?.set_mode(TextMode::Token)?;
                    Ok(())
                })),
                1 => Override::Value(Ok(())),
                _ => Override::Value(Err(Error::Invariant("mode rejected"))),
            }
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-mode".into(),
            class_name: "MutableMode".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-mode", SerializedNode::new())?;
    tx.text(key)?.set_mode(TextMode::Segmented)?;
    tx.text(key)?.set_mode(TextMode::Normal)?;
    assert!(matches!(
        tx.text(key)?.set_mode(TextMode::Normal),
        Err(Error::Invariant("mode rejected"))
    ));
    assert_eq!(tx.view().text_data(key)?.mode, TextMode::Token);
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    Ok(())
}

#[test]
fn mutable_splice_override_applies_once_and_owns_selection_movement() -> Result<(), Error> {
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn check_splice_text(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            range: std::ops::Range<Utf16Offset>,
            insert: &str,
            move_selection: bool,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            assert_eq!(range, Utf16Offset(1)..Utf16Offset(1));
            assert!(move_selection);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CheckSpliceText, |tx| {
                    tx.text(key)?
                        .splice_text(range, &insert.to_uppercase(), move_selection)?;
                    Ok(())
                }),
            )
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-splice".into(),
            class_name: "MutableSplice".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-splice", SerializedNode::new())?;
    tx.text(key)?.set_text_content("ab")?;
    tx.text(key)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.text(key)?
        .splice_text(Utf16Offset(1)..Utf16Offset(1), "z", true)?;
    assert_eq!(tx.text_content(key), "aZb");
    assert_eq!(
        tx.range_selection()?.anchor,
        Point::text(key, Utf16Offset(2))
    );
    assert_eq!(
        tx.range_selection()?.focus,
        Point::text(key, Utf16Offset(2))
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn mutable_text_override_inherits_runtime_parents_and_preserves_native_tab_coercion()
-> Result<(), Error> {
    struct Parent(Arc<AtomicUsize>);
    impl ForeignHooks for Parent {
        fn coerce_text_content(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            value: &str,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(
                tx.with_foreign_native(key, ForeignHook::CoerceTextContent, |tx| {
                    tx.set_foreign_field(key, "requested", serde_json::json!(value))?;
                    tx.text(key)?.set_text_content(value)?;
                    Ok(())
                }),
            )
        }
    }
    struct Child;
    impl ForeignHooks for Child {}
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "mutable-parent".into(),
            class_name: "MutableParent".into(),
            kind: NodeKind::Text,
            extends: Some("tab"),
            required_state: vec![],
            hooks: Arc::new(Parent(calls.clone())),
        })
        .foreign_node(ForeignNodeType {
            type_name: "mutable-child".into(),
            class_name: "MutableChild".into(),
            kind: NodeKind::Text,
            extends: Some("mutable-parent"),
            required_state: vec![],
            hooks: Arc::new(Child),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("mutable-child", SerializedNode::new())?;
    tx.text(key)?.set_text_content("")?;
    assert!(matches!(
        tx.text(key)?.set_text_content("requested"),
        Err(Error::TabSetTextContent)
    ));
    assert_eq!(tx.text_content(key), "\t");
    assert_eq!(
        tx.foreign_data(key).expect("foreign").fields["requested"],
        "requested"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    Ok(())
}

#[test]
fn read_peers_reject_all_runtime_text_operations_before_invoking_mutable_hooks() -> Result<(), Error>
{
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn coerce_text_content(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: &str,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
        fn coerce_detail(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: TextDetail,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
        fn coerce_format(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: TextFormat,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
        fn coerce_mode(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: TextMode,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
        fn check_splice_text(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: std::ops::Range<Utf16Offset>,
            _: &str,
            _: bool,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "readonly-setters".into(),
            class_name: "ReadonlySetters".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("readonly-setters", SerializedNode::new())?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    snapshot.with_read_transaction(tx.committed_state(), |peer| {
        assert!(matches!(
            peer.text(key)?.set_text_content(""),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.text(key)?.set_detail(TextDetail::DIRECTIONLESS),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.text(key)?.set_format(TextFormat::BOLD),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.text(key)?.set_mode(TextMode::Token),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.text(key)?
                .splice_text(Utf16Offset(0)..Utf16Offset(0), "", false),
            Err(Error::ForeignReadOnly)
        ));
        Ok::<_, Error>(())
    })??;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}
