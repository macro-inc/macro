use super::*;
use lexical_rich_nodes::list::register::register_list_nodes;
#[test]
fn macro_two_space_indent_and_upstream_four_space_indent_are_explicit() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let opts = MarkdownOptions {
        list_indent: 2,
        ..Default::default()
    };
    convert_from_markdown_string(&mut tx, "- outer\n  - inner\n- last", &t, None, &opts)?;
    tx.commit()?;
    assert_eq!(
        convert_to_markdown_string(editor.state(), &t, None, &opts)?,
        "- outer\n  - inner\n- last"
    );
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "- outer\n  - inner\n- last",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    assert_eq!(
        convert_to_markdown_string(editor.state(), &t, None, &MarkdownOptions::default())?,
        "- outer\n- inner\n- last"
    );
    assert_eq!(get_indent(" \t  \t ", 2)?, 4);
    assert!(get_indent("", 0).is_err());
    Ok(())
}
#[test]
fn ordered_list_keeps_start_and_bullets_escape_numeric_prefix() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "3. first\n9. second\n\n- 1. text",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    assert_eq!(
        convert_to_markdown_string(editor.state(), &t, None, &MarkdownOptions::default())?,
        "3. first\n4. second\n\n- 1\\. text"
    );
    Ok(())
}
#[test]
fn checklist_is_opt_in_and_uppercase_x_preserves_upstream_check_rule() -> Result<()> {
    let t = Transformers::new([Transformer::Element(std::sync::Arc::new(CheckList))]);
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "+ [x] checked\n+ [X] upper\n+ [ ] empty",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    assert_eq!(
        convert_to_markdown_string(editor.state(), &t, None, &MarkdownOptions::default())?,
        "+ [x] checked\n+ [ ] upper\n+ [ ] empty"
    );
    Ok(())
}
