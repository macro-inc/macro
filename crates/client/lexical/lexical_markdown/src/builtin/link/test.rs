use super::*;
#[test]
fn link_import_recurses_formats_and_escapes_title_on_export() -> Result<()> {
    let t = Transformers::new(
        crate::builtin::text_format_transformers()
            .into_iter()
            .chain(crate::builtin::text_match_transformers()),
    );
    let mut editor =
        lexical_rich_nodes::link::transform::link_extension(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        r#"[**bold**](https://example.com "a\"b")"#,
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let p = st.first_child_or_err(NodeKey::ROOT)?;
    let link = st.first_child_or_err(p)?;
    assert_eq!(
        st.get::<LinkNode>(link).expect("link").title.as_deref(),
        Some("a\"b")
    );
    let text = st.first_child_or_err(link)?;
    assert_eq!(st.text_content(text), "bold");
    assert_eq!(st.text_data(text)?.format.bits(), 1);
    assert_eq!(
        convert_to_markdown_string(st, &t, None, &MarkdownOptions::default())?,
        r#"[**bold**](https://example.com "a\"b")"#
    );
    Ok(())
}
#[test]
fn unmatched_opening_bracket_stays_outside_an_imported_link() -> Result<()> {
    let t = Transformers::new(crate::builtin::text_match_transformers());
    let mut editor =
        lexical_rich_nodes::link::transform::link_extension(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "[[text](https://example.com)",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    let p = tx.first_child_or_err(NodeKey::ROOT)?;
    let first = tx.first_child_or_err(p)?;
    assert_eq!(tx.text_content(first), "[");
    let link = tx.next_sibling(first).expect("link");
    assert!(tx.is::<LinkNode>(link));
    assert_eq!(tx.text_content(link), "text");
    Ok(())
}
