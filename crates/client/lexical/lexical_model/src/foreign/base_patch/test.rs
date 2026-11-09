use super::*;
use std::sync::atomic::{AtomicU32, Ordering};
struct Setters(Arc<AtomicU32>);
impl ForeignHooks for Setters {
    fn coerce_text_content(
        &self,
        _: &mut Transaction<'_>,
        _: NodeKey,
        _: &str,
    ) -> Override<Result<(), Error>> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Override::Value(Err(Error::Invariant("public text setter called")))
    }
    fn set_indent(
        &self,
        _: &mut Transaction<'_>,
        _: NodeKey,
        _: u32,
    ) -> Override<Result<(), Error>> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Override::Value(Err(Error::Invariant("public indent setter called")))
    }
}
#[test]
fn raw_assignments_skip_virtual_setters_and_keep_unknown_alignment() -> Result<(), Error> {
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("text", Arc::new(Setters(calls.clone())))
        .foreign_native_hooks("paragraph", Arc::new(Setters(calls.clone())))
        .build()
        .expect("native hooks");
    let ((p, t), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_with(Text::default(), BaseData::Text(TextData::new("old")))?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), t.key()))
    })?;
    let saved = editor.state().clone();
    let mut tx = editor.transaction();
    assert!(
        tx.patch_foreign_base(t, ForeignBaseField::Text("rejected".into()))
            .is_err()
    );
    tx.mark_dirty(t)?;
    tx.mark_dirty(p)?;
    tx.patch_foreign_base(t, ForeignBaseField::Text("new".into()))?;
    tx.patch_foreign_base(p, ForeignBaseField::Indent(3))?;
    tx.patch_foreign_base(p, ForeignBaseField::Format(99))?;
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    assert_eq!(tx.text_content(t), "new");
    assert_eq!(tx.view().element_data(p)?.indent, 3);
    assert_eq!(tx.view().element_data(p)?.format.bits(), 99);
    assert_eq!(
        tx.export_json(p)?.get("format"),
        Some(&serde_json::json!(""))
    );
    assert_eq!(saved.view().text_content(t), "old");
    tx.flush()?;
    assert!(!tx.needs_flush());
    tx.patch_foreign_base(t, ForeignBaseField::Text("later".into()))?;
    assert!(tx.needs_flush());
    assert_eq!(tx.text_content(t), "later");
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    let before = tx.view().text_data(t)?.clone();
    assert!(
        tx.patch_foreign_base(t, ForeignBaseField::Indent(10))
            .is_err()
    );
    assert_eq!(tx.view().text_data(t)?, &before);
    Ok(())
}
