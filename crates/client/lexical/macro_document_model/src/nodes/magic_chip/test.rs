use super::*;

#[test]
fn ordered_message_preserves_nested_order_and_extra_fields() -> crate::Result<()> {
    let input: SerializedNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#,
    )?;
    let node = MagicChipNode::import_json(&input)?;
    assert_eq!(
        serde_json::to_string(&node)?,
        r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#
    );
    assert_eq!(node.render_revision(), None);
    Ok(())
}

#[test]
fn ordered_message_keeps_existing_validation_errors_and_sequence_admission() -> crate::Result<()> {
    for literal in [
        "null",
        "5",
        r#""message""#,
        r#"{"turn":0,"author":"invalid"}"#,
        "[0]",
    ] {
        let value: Value = serde_json::from_str(literal)?;
        let expected = serde_json::from_value::<MagicChipMessage>(value.clone());
        let actual = serde_json::from_value::<OrderedMagicChipMessage>(value);
        assert!(expected.is_err());
        assert_eq!(
            actual.err().map(|error| error.to_string()),
            expected.err().map(|error| error.to_string())
        );
    }
    let sequence: Value = serde_json::from_str(r#"[0,"user"]"#)?;
    let _: MagicChipMessage = serde_json::from_value(sequence.clone())?;
    let ordered: OrderedMagicChipMessage = serde_json::from_value(sequence.clone())?;
    assert_eq!(serde_json::to_value(ordered)?, sequence);
    Ok(())
}

#[test]
fn ordered_message_typed_constructor_documents_canonical_provenance() -> crate::Result<()> {
    let message = OrderedMagicChipMessage::from_typed(MagicChipMessage {
        turn: 0,
        author: MagicChipAuthor::User,
    })?;
    assert_eq!(
        serde_json::to_string(&message)?,
        r#"{"turn":0,"author":"user"}"#
    );
    Ok(())
}

#[test]
fn ordered_message_survives_real_cow_copy_reparent_import_and_loro() -> crate::Result<()> {
    let mut editor = crate::export_registry();
    let ((left, right, key), _) = editor.update(|tx| {
        let left = tx.create(ClassedBlockNode::default())?;
        let right = tx.create(ClassedBlockNode::default())?;
        let data: SerializedNode = serde_json::from_str(r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#)?;
        let node = tx.create(MagicChipNode::import_json(&data)?)?;
        tx.append(left, &[node.key()])?;
        tx.append(NodeKey::ROOT, &[left.key(), right.key()])?;
        Ok((left.key(), right.key(), node.key()))
    })?;
    let previous = editor.state().clone();
    editor.update(|tx| {
        let data: SerializedNode = serde_json::from_str(r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#)?;
        tx.update_from_json(key, &data)?;
        Ok(())
    })?;
    assert_eq!(previous.get::<MagicChipNode>(key).map(serde_json::to_string).transpose()?, Some(r#"{"agentSessionId":"fixture-agent","promptedMessage":{"turn":0,"author":"user","extra":true},"status":"no_messages"}"#.to_owned()));
    let (copy, _) = editor.update(|tx| {
        tx.append(right, &[key])?;
        let copy = tx.copy_node(key, false)?;
        tx.append(left, &[copy])?;
        Ok(copy)
    })?;
    for node_key in [key, copy] {
        assert_eq!(editor.state().get::<MagicChipNode>(node_key).map(serde_json::to_string).transpose()?, Some(r#"{"agentSessionId":"fixture-agent","promptedMessage":{"author":"user","turn":0,"extra":true},"status":"no_messages"}"#.to_owned()));
    }
    let doc = lexical_loro::new_doc(7)?;
    lexical_loro::mirror::set_state(&doc, &Value::Object(editor.state().to_json()?.root))?;
    let stored = serde_json::to_string(&doc.get_map("root").get_deep_value())?;
    assert!(stored.contains("extra"));
    assert!(!stored.contains("render_revision"));
    Ok(())
}
