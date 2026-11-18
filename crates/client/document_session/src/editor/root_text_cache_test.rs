//! Actual application registry guard for structural native root-text reconciliation.
use lexical_model::*;
use macro_document_model::{
    editor::{EditorType, preset_builder},
    nodes::{AgentSessionMentionNode, DatabaseQueryNode},
};

#[test]
fn macro_plain_split_keeps_root_text_lazy_with_absent_per_instance_decorators()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = preset_builder(EditorType::MarkdownSync).build()?;
    assert!(editor.registry().has::<DatabaseQueryNode>());
    assert!(editor.registry().has::<AgentSessionMentionNode>());
    for index in [
        editor
            .registry()
            .index_of::<DatabaseQueryNode>()
            .expect("database class"),
        editor
            .registry()
            .index_of::<AgentSessionMentionNode>()
            .expect("agent class"),
    ] {
        assert!(
            editor
                .registry()
                .node(index)
                .expect("actual class")
                .flags
                .is_none()
        );
    }
    let (first_text, _) = editor.update(|tx| {
        let mut first_text = None;
        for _ in 0..50 {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("hello world")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            first_text.get_or_insert(text.key());
        }
        Ok(first_text.expect("nonempty document"))
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(first_text)?
            .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
        tx.insert_paragraph()
    })?;
    let view = commit.next.view();
    assert_eq!(view.children_size(NodeKey::ROOT), 51);
    assert_eq!(view.text_content(first_text), "hello");
    assert_eq!(
        view.node_or_err(NodeKey::ROOT)?
            .foreign_raw_root_cached_text(),
        None,
        "registered but absent decorators must not disable the native structural proof"
    );
    let mut expected = vec!["hello".to_owned(), " world".to_owned()];
    expected.extend((1..50).map(|_| "hello world".to_owned()));
    assert_eq!(
        commit.next.root_text_content().as_ref(),
        expected.join("\n\n")
    );
    Ok(())
}
