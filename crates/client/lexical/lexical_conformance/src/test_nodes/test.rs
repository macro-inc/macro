use super::*;
/// upstream: packages/lexical/src/__tests__/utils/index.tsx TestElementNode.importJSON.
#[test]
fn test_block_import_preserves_the_pinned_helpers_inline_return_type() -> Result<(), Error> {
    let mut editor = builder().build().expect("builder");
    let mut tx = editor.transaction();
    let serialized = serde_json::json!({"type":"test_block","version":1,"children":[],"direction":null,"format":"","indent":0});
    let key = tx.import_node(serialized.as_object().expect("object"))?;
    assert!(tx.is::<TestInlineElementNode>(key));
    assert!(tx.is_inline(key));
    assert!(!tx.can_be_empty(key));
    Ok(())
}
/// upstream: seven DEFAULT_NODES test classes plus OverflowNode model flags.
#[test]
fn test_node_flags_text_and_overflow_transform_match_the_oracle_classes() -> Result<(), Error> {
    let mut editor = builder().build().expect("builder");
    let mut tx = editor.transaction();
    let block = tx.create(TestElementNode::default())?;
    let inline = tx.create(TestInlineElementNode::default())?;
    let shadow = tx.create(TestShadowRootNode::default())?;
    let excluded = tx.create(TestExcludeFromCopyElementNode::default())?;
    let text = tx.create(TestTextNode::default())?;
    let segmented = tx.create(TestSegmentedNode::default())?;
    let decorator = tx.create(TestDecoratorNode::default())?;
    let overflow = tx.create(OverflowNode::default())?;
    assert!(!tx.is_inline(block));
    assert!(tx.is_inline(inline));
    assert!(!tx.can_be_empty(inline));
    assert!(tx.is_shadow_root(shadow));
    assert!(tx.exclude_from_copy(excluded, None));
    assert!(tx.is_text(text));
    assert!(tx.is_text(segmented));
    tx.text(segmented)?.set_mode(TextMode::Segmented)?;
    assert!(tx.view().text(segmented).expect("text").is_segmented());
    assert_eq!(tx.text_content(decorator), "Hello world");
    assert!(tx.is_inline(decorator));
    tx.get_mut::<TestDecoratorNode>(decorator)?.block = true;
    assert!(!tx.is_inline(decorator));
    assert!(tx.exclude_from_copy(overflow, None));
    tx.append(NodeKey::ROOT, &[overflow.key()])?;
    tx.flush()?;
    assert!(!tx.is_attached(overflow));
    Ok(())
}
