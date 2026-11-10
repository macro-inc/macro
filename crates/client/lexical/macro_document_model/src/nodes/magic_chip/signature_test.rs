use super::*;

#[test]
fn render_signature_magic_chip_uses_exact_ordered_props_without_eager_revision() -> crate::Result<()>
{
    let node: MagicChipNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#,
    )?;
    let signature = node.render_signature()?.expect("actual signature hook");
    assert_eq!(
        signature.as_str(),
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#
    );
    assert_eq!(node.render_revision(), None);
    let encoded = serde_json::to_string(&node)?;
    assert!(!encoded.contains("render_signature"));
    assert!(!encoded.contains("render_revision"));
    Ok(())
}

#[test]
fn render_signature_magic_chip_order_only_change_survives_real_publication() -> crate::Result<()> {
    let first: MagicChipNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#,
    )?;
    let reordered: MagicChipNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#,
    )?;
    assert_eq!(
        serde_json::to_value(&first)?,
        serde_json::to_value(&reordered)?
    );
    let mut editor = crate::export_registry();
    let (key, initial) = editor.update(|tx| {
        let node = tx.create(first.clone())?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        Ok(node.key())
    })?;
    let ((), published) = editor.update(|tx| {
        *tx.get_mut::<MagicChipNode>(key)? = reordered;
        Ok(())
    })?;
    assert_eq!(
        published.changes.mutations.get(&key),
        Some(&Mutation::Updated)
    );
    let before = initial
        .next
        .get::<MagicChipNode>(key)
        .expect("retained actual payload")
        .render_signature()?
        .expect("before signature");
    let after = published
        .next
        .get::<MagicChipNode>(key)
        .expect("published actual payload")
        .render_signature()?
        .expect("after signature");
    assert_ne!(before, after);
    assert_eq!(
        before.as_str(),
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#
    );
    assert_eq!(
        after.as_str(),
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#
    );
    editor.update(|tx| {
        *tx.get_mut::<MagicChipNode>(key)? = first;
        Ok(())
    })?;
    assert_eq!(
        editor
            .state()
            .get::<MagicChipNode>(key)
            .expect("restored payload")
            .render_signature()?
            .expect("restored signature"),
        before
    );
    Ok(())
}
