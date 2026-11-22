//! Intrinsic behavior beyond serialization.
use lexical_model::*;
use lexical_rich_nodes::mark::MarkNode;
use macro_document_model::{nodes::*, *};
#[test]
fn comment_new_after_keeps_its_subtype_and_metadata() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let comment = tx.create(CommentNode {
        mark: MarkNode {
            ids: vec!["m1".into()],
        },
        thread_id: Maybe::Value(42),
        is_draft: true,
        ids_missing: false,
    })?;
    tx.append(p, &[comment.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let next = tx
        .insert_new_after(comment, SelectionSlot::Active, false)?
        .unwrap();
    assert_eq!(tx.type_name(next)?, "comment-mark");
    assert_eq!(
        tx.get::<CommentNode>(next).unwrap(),
        tx.get::<CommentNode>(comment).unwrap()
    );
    assert_eq!(tx.next_sibling(comment), Some(next));
    Ok(())
}
#[test]
fn expanded_session_hoists_then_collapsed_session_wraps() -> Result<()> {
    let mut editor = export_registry();
    let (mention, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let mention = tx.create(AgentSessionMentionNode {
            id: Maybe::Value("session".into()),
            expanded: true,
            ..Default::default()
        })?;
        tx.append(p, &[mention.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(mention)
    })?;
    assert_eq!(
        editor.state().children_keys(NodeKey::ROOT)?,
        vec![mention.key()]
    );
    editor.update(|tx| {
        tx.get_mut::<AgentSessionMentionNode>(mention)?.expanded = false;
        Ok(())
    })?;
    let state = editor.state();
    let p = state.first_child(NodeKey::ROOT).unwrap();
    assert!(state.is::<Paragraph>(p));
    assert_eq!(state.children_keys(p)?, vec![mention.key()]);
    Ok(())
}
#[test]
fn expanded_session_preserves_both_sides_of_split_paragraph() -> Result<()> {
    let mut editor = export_registry();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let before = tx.create_text("before")?;
        let after = tx.create_text("after")?;
        let mention = tx.create(AgentSessionMentionNode {
            expanded: true,
            ..Default::default()
        })?;
        tx.append(p, &[before.key(), mention.key(), after.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(())
    })?;
    let state = editor.state();
    let children = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 3);
    assert_eq!(state.text_content(children[0]), "before");
    assert!(state.is::<AgentSessionMentionNode>(children[1]));
    assert_eq!(state.text_content(children[2]), "after");
    Ok(())
}

#[test]
fn inline_flags_follow_each_instance_and_subsequent_writes() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    let chip = tx.create(AgentSessionMentionNode::default())?;
    let card = tx.create(AgentSessionMentionNode {
        expanded: true,
        ..Default::default()
    })?;
    let inline = create_await_node(&mut tx, Some("a".into()), None, true)?;
    let block = create_await_node(&mut tx, Some("b".into()), None, false)?;
    assert!(tx.is_inline(chip));
    assert!(!tx.is_inline(card));
    assert!(tx.is_inline(inline));
    assert!(!tx.is_inline(block));
    tx.get_mut::<AgentSessionMentionNode>(chip)?.expanded = true;
    tx.get_mut::<AwaitNode>(block)?.inline = true;
    assert!(!tx.is_inline(chip));
    assert!(tx.is_inline(block));
    let query = tx.import_node(serde_json::json!({"type":"database-query","queryId":"q","prompt":"Count","displayMode":"scalar"}).as_object().unwrap())?;
    assert!(tx.is_inline(query));
    tx.get_mut::<DatabaseQueryNode>(query)?.data.display_mode = DatabaseQueryDisplayMode::Table;
    assert!(!tx.is_inline(query));
    Ok(())
}

#[test]
fn code_writes_preserve_the_raw_language_after_parent_clone_hooks()
-> std::result::Result<(), lexical_model::Error> {
    use lexical_rich_nodes::code::CodeNode;
    use macro_document_model::nodes::CustomCodeNode;
    let mut editor = macro_document_model::export_builder()
        .build()
        .expect("registry");
    let (code, _) = editor.update(|tx| {
        let code = tx.create(CustomCodeNode {
            code: CodeNode {
                language: Some("text".into()),
                theme: Some("raw-theme".into()),
            },
            preview_enabled: false,
        })?;
        tx.append(lexical_model::NodeKey::ROOT, &[code.key()])?;
        Ok(code)
    })?;
    editor.update(|tx| {
        tx.get_mut::<CustomCodeNode>(code)?.preview_enabled = true;
        Ok(())
    })?;
    let state = editor.state();
    let data = state.view().get_or_err::<CustomCodeNode>(code)?;
    assert_eq!(data.code.language.as_deref(), Some("text"));
    assert_eq!(data.code.theme.as_deref(), Some("raw-theme"));
    assert!(data.preview_enabled);
    Ok(())
}
