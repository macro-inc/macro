//! Source registers DetailsNode only in read-only renderers (StaticRenderNodeTypes), and
//! its details transformer returns null in an editor without the node, so editors and
//! services keep GitHub `<details>` as text and never write a details node.
use macro_document_model::*;
use std::sync::Arc;

fn context() -> DocumentContext {
    DocumentContext {
        clock: NodeClock(Arc::new(|| 1794052800000)),
        random: NodeRandom(Arc::new(|size| vec![0; size])),
        host: NodeHost::default(),
        keys: lexical_model::KeySource::default(),
        editor_created: None,
    }
}

#[test]
fn github_details_markdown_imports_as_text_in_an_editor() -> Result<()> {
    let markdown = "<details><summary>Logs</summary>\n\nbody line\n\n</details>";
    let state = markdown::markdown_to_serialized_editor_state_with_ids(markdown, &context())?;
    let json = serde_json::to_string(&state)?;
    assert!(!json.contains(r#""type":"details""#), "{json}");
    assert!(!json.contains(r#""type":"details-summary""#), "{json}");
    let editor = markdown::editor_from_markdown(markdown, &context())?;
    let text = editor
        .state()
        .view()
        .text_content(lexical_model::NodeKey::ROOT);
    assert!(text.contains("<details>"), "{text}");
    assert!(text.contains("</details>"), "{text}");
    Ok(())
}

#[test]
fn an_editor_rejects_a_serialized_details_node_like_source() {
    // Lexical parseEditorState throws for a type the editor did not register.
    let mut editor = surface::preset_builder_with_mode(
        EditorType::MarkdownSync,
        lexical_model::EditorMode::Headless,
    )
    .build()
    .expect("registry");
    let state = r#"{"root":{"type":"root","version":1,"children":[{"type":"details","version":1,"open":false,"children":[{"type":"details-summary","version":1,"children":[]}]}]}}"#;
    assert!(editor.parse_editor_state_str(state).is_err());
}
