use super::*;
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct SignatureNode {
    value: String,
    #[serde(skip)]
    eager: Option<u64>,
}
impl NodeType for SignatureNode {
    const TYPE: &'static str = "signature-fixture";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for SignatureNode {
    decorator_node_base!();
    fn render_revision(&self) -> Option<u64> {
        self.eager
    }
    fn render_signature(&self) -> Result<Option<DecoratorRenderSignature>, Error> {
        Ok(Some(DecoratorRenderSignature::new(self.value.clone())))
    }
}
#[test]
fn decorator_signature_sidecar_uses_final_payload_without_serializing_metadata() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<SignatureNode>()
        .build()
        .expect("signature node registry");
    let (key, commit) = editor.update(|tx| {
        let node = tx.create(SignatureNode {
            value: "{\"turn\":1,\"author\":2}".into(),
            eager: None,
        })?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(node.key())
    })?;
    let before = editor.state().clone();
    let diff = commit.diff(&DiffOptions::default())?;
    assert_eq!(
        diff.decorator_renders,
        vec![DecoratorRenderChange {
            key,
            policy: Some(DecoratorRenderPolicy::Signature(
                DecoratorRenderSignature::new("{\"turn\":1,\"author\":2}".into())
            ))
        }]
    );
    let (_, commit) = editor.update(|tx| {
        tx.update_node::<SignatureNode>(key, |node| node.value = "B".into())?;
        tx.update_node::<SignatureNode>(key, |node| node.value = "{\"turn\":1,\"author\":2}".into())
    })?;
    assert_eq!(
        commit.diff(&DiffOptions::default())?.decorator_renders,
        diff.decorator_renders
    );
    assert_eq!(before.to_json()?, editor.state().to_json()?);
    let (_, invalid) =
        editor.update(|tx| tx.update_node::<SignatureNode>(key, |node| node.eager = Some(1)))?;
    assert!(matches!(
        invalid.diff(&DiffOptions::default()),
        Err(Error::Invariant("conflicting decorator render policies"))
    ));
    Ok(())
}
