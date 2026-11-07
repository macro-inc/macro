use super::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct BlockDecorator {}
impl NodeType for BlockDecorator {
    const TYPE: &'static str = "block-test";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for BlockDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct ShadowRoot {}
impl NodeType for ShadowRoot {
    const TYPE: &'static str = "shadow-test";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for ShadowRoot {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
}
#[test]
fn click_after_last_decorator_inserts_paragraph_and_moves_caret() -> crate::Result<()> {
    let mut editor = register_click_after_last_block(
        Editor::builder(EditorMode::Headless).node::<BlockDecorator>(),
        ClickAfterLastBlockConfig::default(),
    )
    .build()
    .unwrap();
    let (d, _) = editor.update(|tx| {
        let d = tx.create(BlockDecorator {})?;
        tx.append(NodeKey::ROOT, &[d.key()])?;
        Ok(d)
    })?;
    let command = Command::Extension(ExtensionCommand::new(&INSERT_AFTER_LAST_BLOCK, ()));
    let (handled, _) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    let state = editor.state();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert_eq!(children[0], d.key());
    assert!(state.is::<Paragraph>(children[1]));
    assert_eq!(
        state.selection().unwrap().as_range().unwrap().anchor,
        Point::element(children[1], ChildIndex(0))
    );
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().children_size(NodeKey::ROOT), 2);
    Ok(())
}
#[test]
fn predicate_can_reject_last_child() -> crate::Result<()> {
    let mut editor = register_click_after_last_block(
        Editor::builder(EditorMode::Headless).node::<BlockDecorator>(),
        ClickAfterLastBlockConfig {
            should_insert_after: |_, _| false,
        },
    )
    .build()
    .unwrap();
    let (d, _) = editor.update(|tx| {
        let d = tx.create(BlockDecorator {})?;
        tx.append(NodeKey::ROOT, &[d.key()])?;
        Ok(d)
    })?;
    let (handled, commit) = editor.dispatch(&Command::Extension(ExtensionCommand::new(
        &INSERT_AFTER_LAST_BLOCK,
        (),
    )))?;
    assert_eq!(handled, Handled::No);
    assert!(commit.is_noop());
    assert_eq!(editor.state().children_keys(NodeKey::ROOT)?, vec![d.key()]);
    Ok(())
}
#[test]
fn omitting_registration_disables_click_after_last_block() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let (d, _) = editor.update(|tx| {
        let d = tx.create(BlockDecorator {})?;
        tx.append(NodeKey::ROOT, &[d.key()])?;
        Ok(d)
    })?;
    assert_eq!(
        editor
            .dispatch(&Command::Extension(ExtensionCommand::new(
                &INSERT_AFTER_LAST_BLOCK,
                ()
            )))?
            .0,
        Handled::No
    );
    assert_eq!(editor.state().children_keys(NodeKey::ROOT)?, vec![d.key()]);
    Ok(())
}
#[test]
fn empty_root_is_unhandled() -> crate::Result<()> {
    let mut editor = register_click_after_last_block(
        Editor::builder(EditorMode::Headless),
        ClickAfterLastBlockConfig::default(),
    )
    .build()
    .unwrap();
    assert_eq!(
        editor
            .dispatch(&Command::Extension(ExtensionCommand::new(
                &INSERT_AFTER_LAST_BLOCK,
                ()
            )))?
            .0,
        Handled::No
    );
    assert_eq!(editor.state().children_size(NodeKey::ROOT), 0);
    Ok(())
}
#[test]
fn default_predicate_matches_shadow_roots_and_rechecks_current_last_child() -> crate::Result<()> {
    let mut editor = register_click_after_last_block(
        Editor::builder(EditorMode::Headless).node::<ShadowRoot>(),
        ClickAfterLastBlockConfig::default(),
    )
    .build()
    .unwrap();
    let mut tx = editor.transaction();
    let shadow = tx.create(ShadowRoot {})?;
    let p = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[shadow.key()])?;
    assert!(default_should_insert_after(tx.view(), shadow.key()));
    assert!(!default_should_insert_after(tx.view(), p.key()));
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &INSERT_AFTER_LAST_BLOCK,
            ()
        )))?,
        Handled::No
    );
    assert_eq!(
        tx.children_keys(NodeKey::ROOT)?,
        vec![shadow.key(), p.key()]
    );
    Ok(())
}
