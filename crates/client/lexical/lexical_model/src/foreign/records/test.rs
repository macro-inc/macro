use crate::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[test]
fn raw_captures_and_retired_foreign_records_do_not_clone_or_resurrect_live_nodes()
-> Result<(), Error> {
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
    }
    let clones = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "retired-text".into(),
            class_name: "RetiredText".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(clones.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "retired-text",
        serde_json::from_value(serde_json::json!({"label":"before"}))?,
    )?;
    tx.text(key)?.set_text_content("before")?;
    let before = tx.node_or_err(key)?.capture_for_foreign_read();
    tx.text(key)?.set_text_content("last")?;
    tx.set_foreign_field(key, "label", serde_json::json!("after"))?;
    assert_eq!(clones.load(Ordering::SeqCst), 0);
    let BaseData::Text(data) = before.as_ref().base() else {
        panic!("text")
    };
    assert_eq!(data.text.as_str(), "before");
    assert_eq!(
        before
            .as_ref()
            .data_any()
            .downcast_ref::<crate::foreign::projection::ForeignPayload>()
            .expect("payload")
            .user
            .fields["label"],
        "before"
    );
    tx.flush()?;
    assert!(!tx.contains(key));
    assert!(tx.node(key).is_none());
    let retired = tx.retired_record(key).expect("retired");
    assert_eq!(retired.type_name(), "retired-text");
    let BaseData::Text(data) = retired.base() else {
        panic!("text")
    };
    assert_eq!(data.text.as_str(), "last");
    let copied = retired.capture_for_foreign_read();
    assert_eq!(
        copied
            .as_ref()
            .data_any()
            .downcast_ref::<crate::foreign::projection::ForeignPayload>()
            .expect("payload")
            .user
            .fields["label"],
        "after"
    );
    let snapshot = tx.view().snapshot_for_foreign_read()?.clone();
    assert!(!snapshot.state().view().contains(key));
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        assert!(!peer.contains(key));
        assert!(peer.node(key).is_none());
        let retired = peer.retired_record(key).expect("retired");
        assert_eq!(retired.type_name(), "retired-text");
        let BaseData::Text(data) = retired.base() else {
            panic!("text")
        };
        assert_eq!(data.text.as_str(), "last");
        let nested = peer.view().snapshot_for_foreign_read()?;
        nested.with_read_transaction(peer.committed_state(), |inner| {
            assert!(inner.retired_record(key).is_some());
            assert!(inner.node(key).is_none());
        })?;
        Ok(())
    })??;
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    assert!(tx.retired_record(key).is_some());
    assert!(!tx.contains(key));
    assert_eq!(tx.create_text("next")?.key().to_string(), "2");
    assert_eq!(clones.load(Ordering::SeqCst), 0);
    drop(tx);
    drop(editor);
    assert_eq!(copied.as_ref().type_name(), "retired-text");
    assert_eq!(clones.load(Ordering::SeqCst), 0);
    Ok(())
}
