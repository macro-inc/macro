use crate::*;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::Arc;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct Opaque {}
impl NodeType for Opaque {
    const TYPE: &'static str = "opaque";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for Opaque {
    decorator_node_base!();
    fn text_content<'a>(&self, node: NodeView<'a>) -> Cow<'a, str> {
        let text = node
            .state
            .descendants(NodeKey::ROOT)
            .find_map(|(key, _)| node.state.text(key));
        Cow::Owned(text.map_or("", |text| text.text.as_str()).to_owned())
    }
}

#[test]
fn one_text_write_keeps_root_text_lazy_and_old_snapshot_unchanged() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), text.key()))
    })?;
    let previous = editor.state().clone();
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        tx.insert_text("x")
    })?;
    assert!(commit.next.root_text.get().is_none());
    assert_eq!(commit.next.root_text_content().as_ref(), "befxore");
    assert_eq!(previous.root_text_content().as_ref(), "before");
    assert!(!Arc::ptr_eq(
        previous.nodes.get(&NodeKey::ROOT).expect("root"),
        commit.next.nodes.get(&NodeKey::ROOT).expect("root")
    ));
    assert!(Arc::ptr_eq(
        previous.nodes.get(&p).expect("paragraph"),
        commit.next.nodes.get(&p).expect("paragraph")
    ));
    assert_eq!(
        commit.diff(&DiffOptions::default())?.ops,
        vec![DiffOp::Text {
            key: text,
            text: "befxore".into()
        }]
    );
    Ok(())
}

#[test]
fn opaque_text_hooks_disable_local_proof_and_gc_restores_fast_path() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .node::<Opaque>()
        .build()
        .expect("registry");
    let ((text, opaque), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        let opaque = tx.create(Opaque {})?;
        tx.append(p, &[text.key(), opaque.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((text.key(), opaque.key()))
    })?;
    assert_eq!(editor.state().opaque_text_count, 1);
    let previous = editor.state().clone();
    {
        let mut tx = editor.transaction();
        tx.remove(opaque, true)?;
        tx.flush()?;
        assert_eq!(tx.pending.opaque_text_count, 0);
    }
    assert!(previous.same_snapshot(editor.state()));
    assert_eq!(editor.state().opaque_text_count, 1);
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    assert_eq!(commit.next.root_text_content().as_ref(), "afterafter");
    assert_eq!(previous.root_text_content().as_ref(), "beforebefore");
    editor.update(|tx| tx.remove(opaque, true))?;
    assert_eq!(editor.state().opaque_text_count, 0);
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("final")?;
        Ok(())
    })?;
    assert!(commit.next.root_text.get().is_none());
    assert_eq!(commit.next.root_text_content().as_ref(), "final");
    Ok(())
}

#[test]
fn swapping_middle_children_emits_order_with_unchanged_endpoints() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let ((p, a, b, c, d), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        let c = tx.create_text("c")?;
        let d = tx.create_text("d")?;
        tx.text(a)?.set_detail(TextDetail::UNMERGEABLE)?;
        tx.text(b)?.set_detail(TextDetail::UNMERGEABLE)?;
        tx.text(c)?.set_detail(TextDetail::UNMERGEABLE)?;
        tx.text(d)?.set_detail(TextDetail::UNMERGEABLE)?;
        tx.append(p, &[a.key(), b.key(), c.key(), d.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), a.key(), b.key(), c.key(), d.key()))
    })?;
    let (_, commit) = editor.update(|tx| tx.insert_before(b, c, false))?;
    assert_eq!(commit.next.view().first_child(p), Some(a));
    assert_eq!(commit.next.view().last_child(p), Some(d));
    assert_eq!(commit.next.view().children_size(p), 4);
    assert_eq!(
        commit.diff(&DiffOptions::default())?.ops,
        vec![DiffOp::Children {
            parent: p,
            children: vec![a, c, b, d]
        }]
    );
    Ok(())
}

// Upstream v0.45.0 also changes these caches when restoring a view-attached
// snapshot. Exact history JSON identity (S4 P11) therefore uses Headless mode;
// cache eligibility and diff completeness are checked in both modes.
#[test]
fn upstream_restoring_snapshot_reconciles_existing_element_caches() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let ((outer, text), _) = editor.update(|tx| {
        let outer = tx.create(Paragraph::default())?;
        let inner = tx.create(Paragraph::default())?;
        let text = tx.create_text("bold")?;
        tx.text(text)?.set_format(TextFormat::BOLD)?;
        tx.append(inner, &[text.key()])?;
        tx.append(outer, &[inner.key()])?;
        tx.append(NodeKey::ROOT, &[outer.key()])?;
        Ok((outer.key(), text.key()))
    })?;
    let previous = editor.state().clone();
    assert_eq!(
        previous.view().element_data(outer)?.text_format,
        TextFormat::empty()
    );
    editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    editor.set_editor_state(previous.clone(), TagSet::default())?;
    assert_eq!(
        editor.state().view().element_data(outer)?.text_format,
        TextFormat::BOLD
    );
    assert_eq!(
        previous.view().element_data(outer)?.text_format,
        TextFormat::empty()
    );
    Ok(())
}

#[test]
fn root_deletion_preserves_the_insertion_boundary_after_a_decorator() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Opaque>()
        .build()
        .expect("registry");
    editor.update(|tx| {
        let outer = tx.create(Paragraph::default())?;
        let inner = tx.create(Paragraph::default())?;
        let decoration = tx.create(Opaque {})?;
        let empty = tx.create(Paragraph::default())?;
        tx.append(inner, &[decoration.key(), empty.key()])?;
        tx.append(outer, &[inner.key()])?;
        tx.append(NodeKey::ROOT, &[outer.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))
    })?;
    for _ in 0..2 {
        editor.update(|tx| tx.delete_character(EditDirection::Forward, ModifyTarget::NoView))?;
    }
    editor.update(|tx| tx.insert_line_break(false))?;
    let state = editor.state();
    let root = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(root.len(), 2);
    let children = state.children_keys(root[0])?;
    assert_eq!(children.len(), 1);
    assert!(state.is_line_break(children[0]));
    Ok(())
}
