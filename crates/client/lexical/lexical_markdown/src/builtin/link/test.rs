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
/// upstream: partially selected link text keeps the link wrapper.
#[test]
fn partial_link_selection_keeps_link_attributes() -> Result<()> {
    let t = Transformers::new(crate::builtin::text_match_transformers());
    let mut editor =
        lexical_rich_nodes::link::transform::link_extension(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_link_node(&mut tx, "https://example.com", LinkAttributes::default())?;
    let text = tx.create_text("click here")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset::ZERO), Some(Utf16Offset(5)))?;
    assert_eq!(
        convert_selection_to_markdown_string(&tx, &t, tx.selection(), &MarkdownOptions::default())?,
        "[click](https://example.com)"
    );
    Ok(())
}
