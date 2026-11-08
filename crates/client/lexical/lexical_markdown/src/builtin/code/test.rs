use super::*;
/// upstream: single-line code retains the apparent language as content.
#[test]
fn single_line_fence_has_no_language_and_preserves_language_like_text() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let t = Transformers::new([Transformer::MultilineElement(std::sync::Arc::new(Code))]);
    convert_from_markdown_string(&mut tx, "```js x```", &t, None, &MarkdownOptions::default())?;
    tx.commit()?;
    let st = editor.state();
    let code = st.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(st.get::<CodeNode>(code).expect("code").language(), None);
    assert_eq!(st.text_content(code), "js x");
    assert_eq!(
        convert_to_markdown_string(st, &t, None, &MarkdownOptions::default())?,
        "```\njs x\n```"
    );
    Ok(())
}
/// upstream: explicit matching fence length, language and raw nonempty code lines.
#[test]
fn multiline_fence_uses_matching_length_and_keeps_plain_text_and_tabs() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let t = Transformers::new([Transformer::MultilineElement(std::sync::Arc::new(Code))]);
    convert_from_markdown_string(
        &mut tx,
        "````rust\n**literal**\n\tcode\n```\n````",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let code = st.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        st.get::<CodeNode>(code).expect("code").language(),
        Some("rust")
    );
    assert_eq!(st.get_state(code, &CODE_FENCE_STATE)?, "````");
    assert_eq!(st.text_content(code), "**literal**\n\tcode\n```");
    assert!(
        st.descendants(code)
            .all(|(key, _)| !st.is::<CodeHighlightNode>(key))
    );
    assert_eq!(
        convert_to_markdown_string(st, &t, None, &MarkdownOptions::default())?,
        "````rust\n**literal**\n\tcode\n```\n````"
    );
    Ok(())
}
/// upstream: an unclosed one-line code body removes one leading space.
#[test]
fn endless_code_strips_one_leading_space_and_empty_fences_survive() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let t = Transformers::new([Transformer::MultilineElement(std::sync::Arc::new(Code))]);
    convert_from_markdown_string(
        &mut tx,
        "```js\n value",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let code = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(editor.state().text_content(code), "value");
    let mut tx = editor.transaction();
    convert_from_markdown_string(&mut tx, "```\n```", &t, None, &MarkdownOptions::default())?;
    tx.commit()?;
    assert_eq!(
        convert_to_markdown_string(editor.state(), &t, None, &MarkdownOptions::default())?,
        "```\n```"
    );
    Ok(())
}
/// upstream: stored fence grows beyond the longest backtick run on collision.
#[test]
fn export_grows_colliding_fence_and_keeps_stored_highlights_plain() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let t = Transformers::new([Transformer::MultilineElement(std::sync::Arc::new(Code))]);
    let code = create_code_node(&mut tx, Some("js"), None)?;
    let text = tx.create(CodeHighlightNode {
        highlight_type: Some("token".into()),
    })?;
    tx.text(text)?.set_text_content("a ``` b ````` c")?;
    tx.append(code, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[code.key()])?;
    assert_eq!(
        convert_to_markdown_string(&tx, &t, None, &MarkdownOptions::default())?,
        "``````js\na ``` b ````` c\n``````"
    );
    assert_eq!(tx.get_state(code, &CODE_FENCE_STATE)?, "```");
    Ok(())
}
