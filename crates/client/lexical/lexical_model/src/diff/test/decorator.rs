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

#[test]
fn repeated_prepared_full_diff_reads_policies_without_publication()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<SignatureNode>()
        .build()?;
    let (key, _) = editor.update(|tx| {
        let node = tx.create(SignatureNode {
            value: "A".into(),
            eager: None,
        })?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(node.key())
    })?;
    let before = editor.state().to_json()?;
    let mut tx = editor.transaction();
    tx.update_node::<SignatureNode>(key, |node| node.value = "B".into())?;
    tx.request_full_reconcile();
    tx.flush()?;
    let prepared = tx.prepare()?;
    let receipt = prepared.receipt();
    let expected = vec![DecoratorRenderChange {
        key,
        policy: Some(DecoratorRenderPolicy::Signature(
            DecoratorRenderSignature::new("B".into()),
        )),
    }];
    for _ in 0..3 {
        let diff = prepared.diff(&DiffOptions::default())?;
        assert!(diff.full_reconcile);
        assert_eq!(diff.decorator_renders, expected);
        assert!(
            diff.ops
                .iter()
                .all(|op| !matches!(op, DiffOp::SetDecoratorRevision { .. }))
        );
        assert!(receipt.main_publication().is_none());
        assert_eq!(editor.state().to_json()?, before);
    }
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let main = tx.commit()?;
    assert_eq!(receipt.main_publication(), Some(main.id));
    assert_eq!(
        main.diff(&DiffOptions::default())?.decorator_renders,
        expected
    );
    Ok(())
}

#[test]
fn prepared_subtree_removal_retires_clean_decorator_descendants()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<SignatureNode>()
        .build()?;
    let ((parent, key), _) = editor.update(|tx| {
        let parent = tx.create(Paragraph::default())?;
        let node = tx.create(SignatureNode {
            value: "attached".into(),
            eager: None,
        })?;
        tx.append(parent, &[node.key()])?;
        tx.append(NodeKey::ROOT, &[parent.key()])?;
        Ok((parent.key(), node.key()))
    })?;
    let mut tx = editor.transaction();
    tx.remove(parent, true)?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    assert!(!prepared.changes().dirty_leaves.contains(&key));
    let diff = prepared.diff(&DiffOptions::default())?;
    assert_eq!(
        diff.ops
            .iter()
            .filter_map(|op| match op {
                DiffOp::Remove { key, .. } => Some(*key),
                _ => None,
            })
            .collect::<Vec<_>>(),
        vec![parent, key]
    );
    assert_eq!(
        diff.decorator_renders,
        vec![DecoratorRenderChange { key, policy: None }]
    );
    assert_eq!(
        prepared.diff(&DiffOptions::default())?.decorator_renders,
        diff.decorator_renders
    );
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    assert_eq!(
        tx.commit()?
            .diff(&DiffOptions::default())?
            .decorator_renders,
        diff.decorator_renders
    );
    Ok(())
}

#[test]
fn prepared_main_policy_is_distinct_from_actual_folded_return_to_original()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<SignatureNode>()
        .build()?;
    let (key, _) = editor.update(|tx| {
        let node = tx.create(SignatureNode {
            value: "A".into(),
            eager: None,
        })?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(node.key())
    })?;
    let mut tx = editor.transaction();
    tx.update_node::<SignatureNode>(key, |node| node.value = "B".into())?;
    tx.flush()?;
    let prepared = tx.prepare()?;
    assert_eq!(
        prepared.diff(&DiffOptions::default())?.decorator_renders,
        vec![DecoratorRenderChange {
            key,
            policy: Some(DecoratorRenderPolicy::Signature(
                DecoratorRenderSignature::new("B".into())
            ))
        }]
    );
    let mut tx = editor.transaction();
    tx.adopt_prepared_update(prepared)?;
    let mut main = tx.commit()?;
    let (_, following) =
        editor.update(|tx| tx.update_node::<SignatureNode>(key, |node| node.value = "A".into()))?;
    // Fold the two actual publications through the ordinary Commit chain API.
    main.following.push(following);
    assert_eq!(
        main.diff(&DiffOptions::default())?.decorator_renders,
        vec![DecoratorRenderChange {
            key,
            policy: Some(DecoratorRenderPolicy::Signature(
                DecoratorRenderSignature::new("A".into())
            ))
        }]
    );
    Ok(())
}
