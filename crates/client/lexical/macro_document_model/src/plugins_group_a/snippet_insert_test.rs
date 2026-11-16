use crate::nodes::{AwaitNode, InlineSearchNode, Maybe};
use lexical_model::*;
use serde_json::json;

fn editor_with_search(search: &str) -> Result<(Editor, NodeKey), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .extension_state(crate::NodeClock(std::sync::Arc::new(|| 1_000_000)))
    .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
        vec![4; length]
    })))
    .extension_state(crate::NodeHost::default())
    .build()
    .expect("surface");
    let (search, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let before = tx.create_text("ab ")?;
        let search_node = tx.create(InlineSearchNode::default())?;
        tx.text(search_node)?.set_text_content(search)?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[before.key(), search_node.key()])?;
        tx.select_end(search_node)?;
        Ok(search_node.key())
    })?;
    Ok((editor, search))
}

fn command(editor: &Editor, name: &str, payload: serde_json::Value) -> Result<Command, Error> {
    let generation = editor.state().max_key().generation();
    Ok(
        crate::surface::decode_command(name, &payload.to_string(), generation, None)?
            .expect("routed web snippet command"),
    )
}

// Source snippetsPlugin insertSnippet: the active `;` search becomes an inline
// await placeholder, and the host fetch replaces it.
#[test]
fn web_snippet_insert_replaces_the_search_and_resolves_the_fetched_state() -> Result<(), Error> {
    let (mut editor, search) = editor_with_search(";snip")?;
    let start = command(
        &editor,
        "group-a.snippet-insert",
        json!({ "documentId": "snippet-fixture", "sourceDocumentId": "target-fixture" }),
    )?;
    let (handled, commit) = editor.dispatch(&start)?;
    assert_eq!(handled, Handled::Yes);
    assert!(!editor.state().view().contains(search));
    let placeholders = editor.state().view().nodes_of_type::<AwaitNode>();
    assert_eq!(placeholders.len(), 1);
    let placeholder = placeholders[0].key();
    let node = editor
        .state()
        .view()
        .get::<AwaitNode>(placeholder)
        .cloned()
        .expect("await");
    assert_eq!(node.text, Maybe::Value("Inserting snippet...".into()));
    assert!(node.inline);
    let request = commit
        .events
        .iter()
        .find_map(|event| crate::surface::event_payload(event).ok().flatten())
        .expect("snippet request");
    assert_eq!(request["documentId"], "snippet-fixture");
    assert_eq!(request["key"], placeholder.index());

    let resolve = command(
        &editor,
        "group-a.snippet-resolve-source",
        json!({
            "key": request["key"],
            "awaitId": request["awaitId"],
            "source": {"root":{"type":"root","children":[
                {"type":"paragraph","children":[{"type":"text","text":"hello"}]}
            ]}},
        }),
    )?;
    let (handled, commit) = editor.dispatch(&resolve)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::HistoryMerge));
    assert!(
        editor
            .state()
            .view()
            .nodes_of_type::<AwaitNode>()
            .is_empty()
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "ab hello");
    Ok(())
}

#[test]
fn web_snippet_failed_fetch_clears_the_placeholder() -> Result<(), Error> {
    let (mut editor, _) = editor_with_search(";snip")?;
    let start = command(
        &editor,
        "group-a.snippet-insert",
        json!({ "documentId": "snippet-fixture" }),
    )?;
    let (_, commit) = editor.dispatch(&start)?;
    let request = commit
        .events
        .iter()
        .find_map(|event| crate::surface::event_payload(event).ok().flatten())
        .expect("snippet request");
    let resolve = command(
        &editor,
        "group-a.snippet-resolve-source",
        json!({ "key": request["key"], "awaitId": request["awaitId"], "source": null }),
    )?;
    assert_eq!(editor.dispatch(&resolve)?.0, Handled::Yes);
    assert!(
        editor
            .state()
            .view()
            .nodes_of_type::<AwaitNode>()
            .is_empty()
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "ab ");
    Ok(())
}

#[test]
fn web_snippet_refuses_self_insertion_and_non_snippet_searches() -> Result<(), Error> {
    let (mut editor, search) = editor_with_search(";snip")?;
    let start = command(
        &editor,
        "group-a.snippet-insert",
        json!({ "documentId": "same", "sourceDocumentId": "same" }),
    )?;
    assert_eq!(editor.dispatch(&start)?.0, Handled::No);
    assert!(editor.state().view().contains(search));

    let (mut editor, search) = editor_with_search("@snip")?;
    let start = command(
        &editor,
        "group-a.snippet-insert",
        json!({ "documentId": "snippet-fixture" }),
    )?;
    assert_eq!(editor.dispatch(&start)?.0, Handled::No);
    assert!(editor.state().view().contains(search));
    Ok(())
}
