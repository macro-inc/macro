use super::*;
#[test]
fn hard_break_parser_preserves_js_dot_and_whitespace_rules() {
    assert_eq!(
        parse_markdown_hard_line_break("hello  "),
        Some(("hello".into(), "  ".into()))
    );
    assert_eq!(parse_markdown_hard_line_break("  "), None);
    assert_eq!(parse_markdown_hard_line_break("x\r  "), None);
    assert_eq!(parse_markdown_hard_line_break("x\u{2028}y  "), None);
    assert_eq!(
        parse_markdown_hard_line_break("hello\\"),
        Some(("hello".into(), "\\".into()))
    );
}
#[test]
fn hard_break_state_moves_marker_and_resets_on_copy() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("hello  ")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let br = create_markdown_line_break_node(&mut tx, p.key())?;
    tx.append(p, &[br])?;
    assert_eq!(tx.text_content(text), "hello");
    assert_eq!(tx.get_state(br, &HARD_LINE_BREAK_STATE)?, "  ");
    let copy = tx.copy_node(br, false)?;
    assert_eq!(tx.get_state(copy, &HARD_LINE_BREAK_STATE)?, "");
    Ok(())
}
/// upstream: whitespace-only final TextNode checks the current visual line backwards.
#[test]
fn whitespace_marker_scan_stops_at_the_nearest_line_break() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let content = tx.create_text("before")?;
    let existing = tx.create(LineBreak {})?;
    let spaces = tx.create_text("  ")?;
    tx.append(p, &[content.key(), existing.key(), spaces.key()])?;
    let br = create_markdown_line_break_node(&mut tx, p.key())?;
    assert_eq!(tx.get_state(br, &HARD_LINE_BREAK_STATE)?, "");
    assert_eq!(tx.text_content(spaces), "  ");
    let q = tx.create(Paragraph {})?;
    let existing = tx.create(LineBreak {})?;
    let content = tx.create_text("after")?;
    let spaces = tx.create_text("  ")?;
    tx.append(q, &[existing.key(), content.key(), spaces.key()])?;
    let br = create_markdown_line_break_node(&mut tx, q.key())?;
    assert_eq!(tx.get_state(br, &HARD_LINE_BREAK_STATE)?, "  ");
    assert_eq!(tx.text_content(spaces), "");
    Ok(())
}
