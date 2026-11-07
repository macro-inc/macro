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
#[test]
fn ordered_list_start_outside_model_range_is_rejected_instead_of_truncated() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let original = editor.state().clone();
    let mut tx = editor.transaction();
    assert!(matches!(
        convert_from_markdown_string(
            &mut tx,
            "2147483648. item",
            &t,
            None,
            &MarkdownOptions::default()
        ),
        Err(crate::Error::InvalidArgument(_))
    ));
    drop(tx);
    assert!(editor.state().same_snapshot(&original));
    Ok(())
}
/// upstream: list partial selection only includes selected items.
#[test]
fn list_partial_selection_excludes_other_items() -> Result<()> {
    let t = Transformers::new(crate::builtin::element_transformers());
    let mut editor = register_list_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let list = create_list_node(&mut tx, ListType::Bullet, 1)?;
    let a = create_list_item_node(&mut tx, None)?;
    let b = create_list_item_node(&mut tx, None)?;
    let first = tx.create_text("Item 1")?;
    let second = tx.create_text("Item 2")?;
    tx.append(a, &[first.key()])?;
    tx.append(b, &[second.key()])?;
    tx.append(list, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[list.key()])?;
    tx.text(second)?.select(Some(Utf16Offset::ZERO), None)?;
    assert_eq!(
        convert_selection_to_markdown_string(&tx, &t, tx.selection(), &MarkdownOptions::default())?,
        "- Item 2"
    );
    Ok(())
}
