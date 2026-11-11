use super::*;
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ContextDefault {
    value: u32,
}
impl NodeType for ContextDefault {
    const TYPE: &'static str = "context-default";
    type Kind = DecoratorKind;
    impl_default_node!();
    fn create_default(tx: &mut Transaction<'_>) -> Result<NodeKey, Error> {
        let value = *tx.extension::<u32>()?;
        Ok(tx.create_exact(Self { value })?.key())
    }
}
impl DecoratorNode for ContextDefault {
    decorator_node_base!();
}
#[test]
fn registry_default_creation_reads_explicit_editor_context() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ContextDefault>()
        .extension_state(42u32)
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let key = tx.create_resolved::<ContextDefault>()?;
    assert_eq!(tx.get::<ContextDefault>(key).unwrap().value, 42);
    let mut without_context = Editor::builder(EditorMode::Headless)
        .node::<ContextDefault>()
        .build()
        .unwrap();
    assert!(matches!(
        without_context
            .transaction()
            .create_resolved::<ContextDefault>(),
        Err(Error::UnknownExtensionState { .. })
    ));
    Ok(())
}
