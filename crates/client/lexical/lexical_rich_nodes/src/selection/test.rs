use super::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct InlineElement {}
impl NodeType for InlineElement {
    const TYPE: &'static str = "inline-element";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for InlineElement {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
}
#[test]
fn document_edges_and_text_interior_do_not_override_character_selection() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("hello")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert!(!should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::text(text, Utf16Offset(0))),
        true
    )?);
    assert!(!should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::text(text, Utf16Offset(5))),
        false
    )?);
    assert!(!should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::text(text, Utf16Offset(2))),
        false
    )?);
    assert!(!should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::element(NodeKey::ROOT, ChildIndex(1))),
        false
    )?);
    Ok(())
}
#[test]
fn entering_inline_wrapper_is_not_overridden_but_entering_next_block_is() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineElement>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let next = tx.create(Paragraph {})?;
    let inline = tx.create(InlineElement {})?;
    let a = tx.create_text("a")?;
    let b = tx.create_text("b")?;
    tx.append(inline, &[b.key()])?;
    tx.append(p, &[a.key(), inline.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), next.key()])?;
    assert!(!should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::text(a, Utf16Offset(1))),
        false
    )?);
    assert!(should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::text(b, Utf16Offset(1))),
        false
    )?);
    assert!(should_override_default_character_selection(
        tx.view(),
        &RangeSelection::collapsed(Point::element(next, ChildIndex(0))),
        true
    )?);
    Ok(())
}
