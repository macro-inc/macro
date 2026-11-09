use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
struct Hooks(Arc<AtomicUsize>);
impl ForeignHooks for Hooks {
    fn can_indent(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Override::Value(false)
    }
    fn set_indent(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        indent: u32,
    ) -> Override<Result<(), Error>> {
        Override::Value(tx.with_foreign_native(key, ForeignHook::SetIndent, |tx| {
            tx.set_indent(key, indent + 1)
        }))
    }
    fn coerce_text_content(
        &self,
        tx: &mut Transaction<'_>,
        key: NodeKey,
        text: &str,
    ) -> Override<Result<(), Error>> {
        Override::Value(
            tx.with_foreign_native(key, ForeignHook::CoerceTextContent, |tx| {
                tx.text(key)?.set_text_content(&format!("{text}!"))?;
                Ok(())
            }),
        )
    }
}
struct Inherited;
impl ForeignHooks for Inherited {}

#[test]
fn native_overlays_preserve_typed_records_and_do_not_probe_hooks() -> Result<(), Error> {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("paragraph", Arc::new(Hooks(calls.clone())))
        .foreign_native_hooks("text", Arc::new(Hooks(calls.clone())))
        .build()
        .expect("native overlays");
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    assert!(
        editor
            .registry()
            .type_table()
            .iter()
            .filter(|row| matches!(row.type_name, "paragraph" | "text"))
            .all(|row| row.flags.is_none())
    );
    assert!(editor.registry().has::<Paragraph>());
    assert!(editor.registry().has::<Text>());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("initial")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert!(!tx.can_indent(p));
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    tx.set_indent(p, 2)?;
    assert_eq!(tx.indent(p), 3);
    tx.text(t)?.set_text_content("changed")?;
    assert_eq!(tx.text_content(t), "changed!");
    assert!(tx.node_or_err(p)?.get::<Paragraph>().is_some());
    assert!(tx.node_or_err(t)?.get::<Text>().is_some());
    assert_eq!(
        tx.export_json(p)?
            .get("type")
            .and_then(serde_json::Value::as_str),
        Some("paragraph")
    );
    Ok(())
}

#[test]
fn dynamic_child_inherits_native_overlay_and_projected_baseline() -> Result<(), Error> {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("paragraph", Arc::new(Hooks(calls.clone())))
        .foreign_node(ForeignNodeType {
            type_name: Arc::from("custom-paragraph"),
            class_name: Arc::from("CustomParagraph"),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Inherited),
        })
        .build()
        .expect("dynamic native overlay child");
    assert_eq!(calls.load(Ordering::Relaxed), 0);
    let mut tx = editor.transaction();
    let p = tx.create_foreign("custom-paragraph", SerializedNode::new())?;
    let t = tx.create_text("child text")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p])?;
    assert!(!tx.can_indent(p));
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    tx.set_indent(p, 4)?;
    assert_eq!(tx.indent(p), 5);
    assert_eq!(tx.text_content(p), "child text");
    assert_eq!(tx.children_keys(p)?, vec![t.key()]);
    assert_eq!(
        tx.export_json(p)?
            .get("type")
            .and_then(serde_json::Value::as_str),
        Some("custom-paragraph")
    );
    Ok(())
}

#[test]
fn native_overlay_registration_rejects_missing_dynamic_and_duplicate_targets() {
    assert!(
        Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("absent", Arc::new(Inherited))
            .build()
            .is_err()
    );
    assert!(
        Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("paragraph", Arc::new(Inherited))
            .foreign_native_hooks("paragraph", Arc::new(Inherited))
            .build()
            .is_err()
    );
    assert!(
        Editor::builder(EditorMode::Headless)
            .foreign_node(ForeignNodeType {
                type_name: Arc::from("custom-paragraph"),
                class_name: Arc::from("CustomParagraph"),
                kind: NodeKind::Element,
                extends: Some("paragraph"),
                required_state: vec![],
                hooks: Arc::new(Inherited),
            })
            .foreign_native_hooks("custom-paragraph", Arc::new(Inherited))
            .build()
            .is_err()
    );
}

struct Excluded;
impl ForeignHooks for Excluded {
    fn adjust_export_json(
        &self,
        _: NodeView<'_>,
        _: &ForeignData,
        _: &mut SerializedNode,
    ) -> Override<Result<(), Error>> {
        Override::Value(Err(Error::Invariant("excluded export must not run")))
    }
    fn static_transform(&self, _: &mut Transaction<'_>, _: NodeKey) -> Override<Result<(), Error>> {
        Override::Value(Err(Error::Invariant(
            "excluded static transform must not run",
        )))
    }
}

#[test]
fn excluded_callbacks_stay_separate_and_explicit_transforms_reach_dynamic_children()
-> Result<(), Error> {
    static TRANSFORMS: AtomicUsize = AtomicUsize::new(0);
    TRANSFORMS.store(0, Ordering::Relaxed);
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("paragraph", Arc::new(Excluded))
        .transform::<Paragraph>(|tx, id| {
            if tx.node_or_err(id)?.type_name() == "custom-paragraph" {
                TRANSFORMS.fetch_add(1, Ordering::Relaxed);
            }
            Ok(())
        })
        .foreign_node(ForeignNodeType {
            type_name: Arc::from("custom-paragraph"),
            class_name: Arc::from("CustomParagraph"),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Inherited),
        })
        .build()
        .expect("native overlay callbacks");
    let mut tx = editor.transaction();
    let native = tx.create(Paragraph::default())?;
    tx.export_json(native)?;
    let p = tx.create_foreign("custom-paragraph", SerializedNode::new())?;
    let t = tx.create_text("keep child")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p])?;
    tx.export_json(p)?;
    tx.commit()?;
    assert_eq!(TRANSFORMS.load(Ordering::Relaxed), 1);
    assert_eq!(editor.state().root_text_content().as_ref(), "keep child");
    Ok(())
}
