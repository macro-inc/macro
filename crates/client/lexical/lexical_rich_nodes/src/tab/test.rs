use super::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct NoIndent {}
impl NodeType for NoIndent {
    const TYPE: &'static str = "no-indent";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for NoIndent {
    element_node_base!();
    fn can_indent(&self, _: ElementView<'_>) -> bool {
        false
    }
}
#[test]
fn tab_indents_at_block_start_but_inserts_tab_inside_text() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert!(indent_over_tab(
        &tx,
        &RangeSelection::collapsed(Point::text(t, Utf16Offset(0)))
    )?);
    assert!(!indent_over_tab(
        &tx,
        &RangeSelection::collapsed(Point::text(t, Utf16Offset(2)))
    )?);
    assert!(!indent_over_tab(
        &tx,
        &RangeSelection::collapsed(Point::element(p, ChildIndex(0)))
    )?);
    Ok(())
}
#[test]
fn selected_blocks_indent_once_below_exclusive_maximum() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(5)))?;
    assert!(indent_with_limit(&mut tx, Some(2), &|v, k| v.can_indent(k))?);
    assert_eq!(tx.indent(p), 1);
    assert!(indent_with_limit(&mut tx, Some(2), &|v, k| v.can_indent(k))?);
    assert_eq!(tx.indent(p), 1);
    Ok(())
}
#[test]
fn zero_maximum_is_unlimited_and_custom_predicate_can_reject() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.set_indent(p, 5)?;
    tx.select_start(t)?;
    assert!(indent_with_limit(&mut tx, Some(0), &|_, _| true)?);
    assert_eq!(tx.indent(p), 6);
    assert!(indent_with_limit(&mut tx, None, &|_, _| false)?);
    assert_eq!(tx.indent(p), 6);
    Ok(())
}
#[test]
fn no_selection_or_nonindenting_block_is_unhandled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NoIndent>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    assert!(!indent_with_limit(&mut tx, None, &|_, _| true)?);
    let p = tx.create(NoIndent {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_start(t)?;
    assert!(!indent_over_tab(&tx, tx.range_selection()?)?);
    assert!(!indent_with_limit(&mut tx, None, &|_, _| true)?);
    assert_eq!(tx.indent(p), 0);
    assert_eq!(
        crate::utils::get_nearest_block_element_ancestor_or_throw(tx.view(), t.key())?,
        p.key()
    );
    assert!(
        crate::utils::get_nearest_block_element_ancestor_or_throw(tx.view(), NodeKey::ROOT)
            .is_err()
    );
    Ok(())
}
