use super::*;
use crate::builtin::*;
use lexical_rich_nodes::link::*;
/// upstream: export format tag stacks close outside a nested link.
#[test]
fn inline_link_closes_sibling_formats_at_nontext_boundaries() -> Result<()> {
    let transformers = Transformers::new(
        text_format_transformers()
            .into_iter()
            .chain(text_match_transformers()),
    );
    let mut editor =
        lexical_rich_nodes::link::transform::link_extension(Editor::builder(EditorMode::Headless))
            .build()
            .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let first = tx.create_text("before ")?;
    let link = create_link_node(&mut tx, "https://example.com", LinkAttributes::default())?;
    let inside = tx.create_text("inside")?;
    let after = tx.create_text(" after")?;
    tx.text(first)?.set_format(TextFormat::BOLD)?;
    tx.text(inside)?
        .set_format(TextFormat::BOLD | TextFormat::ITALIC)?;
    tx.text(after)?.set_format(TextFormat::BOLD)?;
    tx.append(link, &[inside.key()])?;
    tx.append(p, &[first.key(), link.key(), after.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert_eq!(
        convert_to_markdown_string(&tx, &transformers, None, &MarkdownOptions::default())?,
        "**before** [***inside***](https://example.com) **after**"
    );
    Ok(())
}
/// upstream: whitespace hoisting, code and literal backslash preservation.
#[test]
fn formatted_whitespace_and_code_escape_rules() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("  hi  ")?;
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert_eq!(
        convert_to_markdown_string(&tx, &transformers, None, &MarkdownOptions::default())?,
        "  **hi**  "
    );
    tx.text(text)?
        .set_text_content("a\\*b")?
        .set_format(TextFormat::CODE)?;
    assert_eq!(
        convert_to_markdown_string(&tx, &transformers, None, &MarkdownOptions::default())?,
        "`a\\*b`"
    );
    tx.text(text)?.set_format(TextFormat::empty())?;
    assert_eq!(
        convert_to_markdown_string(
            &tx,
            &transformers,
            None,
            &MarkdownOptions {
                should_preserve_new_lines: true,
                ..Default::default()
            }
        )?,
        "a\\\\*b"
    );
    Ok(())
}
/// upstream: selection export slices actual UTF-16 text and handles null/collapsed ranges.
#[test]
fn selection_export_slices_astral_text_and_keeps_format() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("😀hello")?;
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(5)))?;
    assert_eq!(
        convert_selection_to_markdown_string(
            &tx,
            &transformers,
            tx.selection(),
            &MarkdownOptions::default()
        )?,
        "**hel**"
    );
    assert_eq!(
        convert_selection_to_markdown_string(
            &tx,
            &transformers,
            None,
            &MarkdownOptions::default()
        )?,
        ""
    );
    tx.select_start(text)?;
    assert_eq!(
        convert_selection_to_markdown_string(
            &tx,
            &transformers,
            tx.selection(),
            &MarkdownOptions::default()
        )?,
        ""
    );
    Ok(())
}
/// upstream: token and segmented text exports whole content even for partial selection.
#[test]
fn partial_selection_does_not_slice_token_or_segmented_text() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("whole")?;
    tx.text(text)?.set_mode(TextMode::Token)?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(3)))?;
    assert_eq!(
        convert_selection_to_markdown_string(
            &tx,
            &Transformers::default(),
            tx.selection(),
            &MarkdownOptions::default()
        )?,
        "whole"
    );
    tx.text(text)?.set_mode(TextMode::Segmented)?;
    assert_eq!(
        convert_selection_to_markdown_string(
            &tx,
            &Transformers::default(),
            tx.selection(),
            &MarkdownOptions::default()
        )?,
        "whole"
    );
    Ok(())
}
