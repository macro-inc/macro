//! Producer availability RED; no receipt APIs or production hunks are required.
use crate::{EditorType, NodeRandom, nodes::AwaitNode, surface};
use lexical_model::*;
use std::sync::Arc;

#[test]
fn database_start_decodes_and_inserts_the_real_inline_await() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::Headless)
            .extension_state(NodeRandom(Arc::new(|length| vec![0; length])))
            .build()
            .expect("surface");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("Before. After.")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(text)
    })?;
    let command = surface::decode_command(
        "group-b.database-create-start",
        "{}",
        editor.state().max_key().generation(),
        None,
    )?
    .expect("Source Database producer is required");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let nodes = lexical_rich_nodes::utils::dfs(editor.state().view(), None, None)
        .into_iter()
        .filter(|entry| editor.state().view().is::<AwaitNode>(entry.node))
        .collect::<Vec<_>>();
    assert_eq!(nodes.len(), 1);
    let awaiting = editor
        .state()
        .view()
        .get_or_err::<AwaitNode>(nodes[0].node)?;
    assert_eq!(awaiting.text.as_deref(), Some("Creating database…"));
    assert!(awaiting.inline);
    assert_eq!(awaiting.await_id.as_deref().expect("minted id").len(), 21);
    Ok(())
}

#[test]
fn missing_database_target_is_handled_without_constructing_a_replacement() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::Headless)
            .extension_state(NodeRandom(Arc::new(|_| {
                panic!("missing target constructed a node")
            })))
            .build()
            .expect("surface");
    let command = surface::decode_command(
        "group-b.database-create-complete",
        r#"{"key":4294967295,"documentId":"synthetic-database"}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("Source Database completion producer is required");
    let before = editor.state().to_json()?;
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.is_noop());
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}
