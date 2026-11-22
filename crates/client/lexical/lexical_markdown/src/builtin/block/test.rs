use super::*;
#[test]
fn heading_and_quote_import_export_keep_block_boundaries() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor =
        lexical_rich_nodes::register_rich_text_nodes(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "## title\n\n> one  \n> two",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let children = st.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert_eq!(
        st.get::<HeadingNode>(children[0]).expect("heading").tag,
        HeadingTagType::H2
    );
    assert_eq!(st.text_content(children[1]), "one\ntwo");
    assert_eq!(
        convert_to_markdown_string(st, &t, None, &MarkdownOptions::default())?,
        "## title\n\n> one  \n> two"
    );
    Ok(())
}
#[test]
fn missing_registered_dependency_is_a_typed_error() {
    let t = Transformers::new(crate::builtin::element_transformers());
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    assert!(matches!(
        t.check_dependencies(&editor),
        Err(crate::Error::MissingNode {
            type_name: "heading"
        })
    ));
}
/// upstream: quote partial selection only includes selected text.
#[test]
fn quote_partial_selection_excludes_earlier_line() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor =
        lexical_rich_nodes::register_rich_text_nodes(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    let quote = create_quote_node(&mut tx)?;
    let first = tx.create_text("Line 1")?;
    let br = tx.create(LineBreak {})?;
    let second = tx.create_text("Line 2")?;
    tx.append(quote, &[first.key(), br.key(), second.key()])?;
    tx.append(NodeKey::ROOT, &[quote.key()])?;
    tx.text(second)?.select(Some(Utf16Offset::ZERO), None)?;
    assert_eq!(
        convert_selection_to_markdown_string(&tx, &t, tx.selection(), &MarkdownOptions::default())?,
        "> Line 2"
    );
    Ok(())
}
