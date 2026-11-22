use super::*;
use std::sync::Arc;

#[test]
fn foreign_diff_serialization_failure_does_not_publish_the_proposed_state() -> Result<(), Error> {
    struct RejectExport;
    impl ForeignHooks for RejectExport {
        fn adjust_export_json(
            &self,
            _node: NodeView<'_>,
            _data: &ForeignData,
            _json: &mut SerializedNode,
        ) -> Override<Result<(), Error>> {
            Override::Value(Err(Error::Invariant("foreign export failed")))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "reject-export".into(),
            class_name: "RejectExport".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(RejectExport),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("reject-export", SerializedNode::new())?;
    tx.append(NodeKey::ROOT, &[key])?;
    let result = tx.commit_foreign(|commit| HostCommitPacket::from_commit(commit, 1));
    assert!(matches!(
        result,
        Err(Error::Invariant("foreign export failed"))
    ));
    assert!(editor.state().is_empty_state());
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let (_, packet) = tx.commit_foreign(|commit| HostCommitPacket::from_commit(commit, 2))?;
    assert!(packet.changed);
    assert_eq!(editor.state().children_size(NodeKey::ROOT), 1);
    Ok(())
}
