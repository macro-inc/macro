use super::*;

#[test]
fn render_signature_agent_activity_uses_exact_ordered_props_without_eager_revision()
-> crate::Result<()> {
    let node: AgentActivityNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","turn":0,"segment":0,"rows":[],"sealed":false}"#,
    )?;
    let signature = node.render_signature()?.expect("actual signature hook");
    assert_eq!(
        signature.as_str(),
        r#"{"agentSessionId":"fixture-agent","turn":0,"segment":0,"rows":[],"sealed":false}"#
    );
    assert_eq!(node.render_revision(), None);
    let encoded = serde_json::to_string(&node)?;
    assert!(!encoded.contains("render_signature"));
    assert!(!encoded.contains("render_revision"));
    Ok(())
}

#[test]
fn render_signature_agent_activity_order_only_change_survives_real_publication() -> crate::Result<()>
{
    let first: AgentActivityNode = serde_json::from_str(
        r#"{"agentSessionId":"fixture-agent","turn":0,"segment":0,"rows":[],"sealed":false}"#,
    )?;
    let reordered: AgentActivityNode = serde_json::from_str(
        r#"{"rows":[],"sealed":false,"segment":0,"turn":0,"agentSessionId":"fixture-agent"}"#,
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
        *tx.get_mut::<AgentActivityNode>(key)? = reordered;
        Ok(())
    })?;
    assert_eq!(
        published.changes.mutations.get(&key),
        Some(&Mutation::Updated)
    );
    let before = initial
        .next
        .get::<AgentActivityNode>(key)
        .expect("retained actual payload")
        .render_signature()?
        .expect("before signature");
    let after = published
        .next
        .get::<AgentActivityNode>(key)
        .expect("published actual payload")
        .render_signature()?
        .expect("after signature");
    assert_ne!(before, after);
    assert_eq!(
        before.as_str(),
        r#"{"agentSessionId":"fixture-agent","turn":0,"segment":0,"rows":[],"sealed":false}"#
    );
    assert_eq!(
        after.as_str(),
        r#"{"rows":[],"sealed":false,"segment":0,"turn":0,"agentSessionId":"fixture-agent"}"#
    );
    editor.update(|tx| {
        *tx.get_mut::<AgentActivityNode>(key)? = first;
        Ok(())
    })?;
    assert_eq!(
        editor
            .state()
            .get::<AgentActivityNode>(key)
            .expect("restored payload")
            .render_signature()?
            .expect("restored signature"),
        before
    );
    Ok(())
}
