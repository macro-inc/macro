use super::*;
use lexical_model::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct InlineDecorator {}
impl NodeType for InlineDecorator {
    const TYPE: &'static str = "inline-test";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for InlineDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        true
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct BlockDecorator {}
impl NodeType for BlockDecorator {
    const TYPE: &'static str = "block-test";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for BlockDecorator {
    decorator_node_base!();
    fn is_inline(&self, _: DecoratorView<'_>) -> bool {
        false
    }
}

// Upstream EscapeFormatTriggers.test.ts: click_end.
#[test]
fn escape_code_click_end() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    click(&mut tx, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: click_start.
#[test]
fn escape_code_click_start() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    click(&mut tx, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: click_middle.
#[test]
fn escape_code_click_middle() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    click(&mut tx, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: click_end_with_next_sibling.
#[test]
fn escape_code_click_end_with_next_sibling() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let next = tx.create_text("next")?;
    tx.append(p, &[next.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    click(&mut tx, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: enter_end.
#[test]
fn escape_code_enter_end() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    prepare_enter(&mut tx, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: enter_start.
#[test]
fn escape_code_enter_start() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    prepare_enter(&mut tx, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: enter_middle.
#[test]
fn escape_code_enter_middle() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    prepare_enter(&mut tx, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: arrow_right_end.
#[test]
fn escape_code_arrow_right_end() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_right(&mut tx, false, false, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: shift_arrow_right_end.
#[test]
fn escape_code_shift_arrow_right_end() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_right(&mut tx, true, false, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: arrow_right_middle.
#[test]
fn escape_code_arrow_right_middle() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_right(&mut tx, false, false, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: arrow_left_start.
#[test]
fn escape_code_arrow_left_start() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_left(&mut tx, false, false, &cfg)?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: shift_arrow_left_start.
#[test]
fn escape_code_shift_arrow_left_start() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_left(&mut tx, true, false, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

// Upstream EscapeFormatTriggers.test.ts: arrow_left_middle.
#[test]
fn escape_code_arrow_left_middle() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?
        .set_format(TextFormat::CODE)?
        .set_style("color: red")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    tx.set_selection_format(TextFormat::CODE)?;
    tx.set_selection_style("color: red")?;
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            enter: Some(true),
            click: Some(true),
            arrow: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    arrow_left(&mut tx, false, false, &cfg)?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Code));
    assert_eq!(tx.range_selection()?.style.as_ref(), "color: red");
    assert_eq!(tx.text_data(t)?.format, TextFormat::CODE);
    Ok(())
}

#[test]
fn default_capitalize_escapes_on_enter() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::CAPITALIZE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Enter,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Capitalize));
    Ok(())
}

#[test]
fn default_capitalize_escapes_on_space() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::CAPITALIZE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Capitalize));
    Ok(())
}

#[test]
fn default_capitalize_escapes_on_tab() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::CAPITALIZE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Tab,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Capitalize));
    Ok(())
}

#[test]
fn default_lowercase_escapes_on_enter() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::LOWERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Enter,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Lowercase));
    Ok(())
}

#[test]
fn default_lowercase_escapes_on_space() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::LOWERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Lowercase));
    Ok(())
}

#[test]
fn default_lowercase_escapes_on_tab() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::LOWERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Tab,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Lowercase));
    Ok(())
}

#[test]
fn default_uppercase_escapes_on_enter() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::UPPERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Enter,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Uppercase));
    Ok(())
}

#[test]
fn default_uppercase_escapes_on_space() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::UPPERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Uppercase));
    Ok(())
}

#[test]
fn default_uppercase_escapes_on_tab() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(t)?;
    tx.set_selection_format(TextFormat::UPPERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Tab,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Uppercase));
    Ok(())
}
#[test]
fn merge_preserves_defaults_and_shallow_merges_optional_fields() {
    let original = RichTextConfig::default();
    let overrides = RichTextConfig {
        escape_format_triggers: EscapeFormatTriggerConfig(vec![
            (
                TextFormatType::Code,
                Some(TriggerConfig {
                    enter: Some(true),
                    only_at_boundary: Some(true),
                    ..TriggerConfig::default()
                }),
            ),
            (
                TextFormatType::Uppercase,
                Some(TriggerConfig {
                    enter: Some(false),
                    click: Some(true),
                    ..TriggerConfig::default()
                }),
            ),
        ]),
    };
    let merged = original.merge(&overrides);
    assert_eq!(merged.escape_format_triggers.0.len(), 4);
    let uppercase = merged.escape_format_triggers.0[2].1.unwrap();
    assert_eq!(uppercase.enter, Some(false));
    assert_eq!(uppercase.space, Some(true));
    assert_eq!(uppercase.tab, Some(true));
    assert_eq!(uppercase.click, Some(true));
    assert_eq!(
        original.escape_format_triggers.0[2].1.unwrap().enter,
        Some(true)
    );
}
#[test]
fn null_disables_default_uppercase_reset() -> crate::Result<()> {
    let cfg = RichTextConfig::default().merge(&RichTextConfig {
        escape_format_triggers: EscapeFormatTriggerConfig(vec![(TextFormatType::Uppercase, None)]),
    });
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_start(p)?;
    tx.set_selection_format(TextFormat::UPPERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &cfg.escape_format_triggers,
    )?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Uppercase));
    Ok(())
}
#[test]
fn format_config_can_change_between_commands() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_start(p)?;
    tx.set_selection_format(TextFormat::UPPERCASE)?;
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &EscapeFormatTriggerConfig(vec![]),
    )?;
    assert!(tx.range_selection()?.has_format(TextFormatType::Uppercase));
    escape_on_key(
        &mut tx,
        EscapeFormatTrigger::Space,
        &EscapeFormatTriggerConfig::default(),
    )?;
    assert!(!tx.range_selection()?.has_format(TextFormatType::Uppercase));
    Ok(())
}
#[test]
fn escaping_detached_range_leaves_active_typing_state_unchanged() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("hello")?;
    tx.text(t)?.set_format(TextFormat::CODE)?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_start(t)?;
    tx.set_selection_format(TextFormat::BOLD)?;
    let mut range = RangeSelection::collapsed(Point::text(t, Utf16Offset(5)));
    range.set_format(TextFormat::CODE);
    range.set_style("color: red");
    let slot = tx.detach_selection(Selection::Range(range));
    let cfg = EscapeFormatTriggerConfig(vec![(
        TextFormatType::Code,
        Some(TriggerConfig {
            click: Some(true),
            only_at_boundary: Some(true),
            ..TriggerConfig::default()
        }),
    )]);
    escape_formats_for_trigger(
        &mut tx,
        slot,
        EscapeFormatTrigger::Click,
        EscapeDirection::Both,
        &cfg,
    )?;
    assert_eq!(tx.range_at(slot)?.format, TextFormat::empty());
    assert_eq!(tx.range_at(slot)?.style.as_ref(), "");
    assert_eq!(tx.range_selection()?.format, TextFormat::BOLD);
    Ok(())
}
#[test]
fn insert_tab_applies_selection_format_and_style() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(2)))?;
    assert!(format_text(&mut tx, TextFormatType::Bold)?);
    tx.set_selection_style("color: red")?;
    assert!(insert_tab(&mut tx)?);
    let tab = tx.all_text_nodes(p).find(|k| tx.is::<Tab>(*k)).unwrap();
    assert_eq!(tx.text_data(tab)?.format, TextFormat::BOLD);
    assert_eq!(tx.text_data(tab)?.style.as_ref(), "color: red");
    Ok(())
}
#[test]
fn bold_format_survives_typing_between_two_inserted_tabs() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let t = tx.create_text("ab")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(t)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(2)))?;
    format_text(&mut tx, TextFormatType::Bold)?;
    tx.text(t)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    insert_tab(&mut tx)?;
    insert_tab(&mut tx)?;
    let tabs: Vec<_> = tx.all_text_nodes(p).filter(|k| tx.is::<Tab>(*k)).collect();
    assert_eq!(tabs.len(), 2);
    tx.select_start(tabs[1])?;
    controlled_text_insertion(&mut tx, "x")?;
    let x = tx
        .all_text_nodes(p)
        .find(|k| tx.text_content(*k) == "x")
        .unwrap();
    assert_eq!(tx.text_data(x)?.format, TextFormat::BOLD);
    assert_eq!(tx.text_content(p), "a\tx\tb");
    Ok(())
}
#[test]
fn enter_after_sole_block_decorator_inserts_paragraph() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<BlockDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let d = tx.create(BlockDecorator {})?;
    tx.append(NodeKey::ROOT, &[d.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(d);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(prepare_enter(
        &mut tx,
        &EscapeFormatTriggerConfig::default()
    )?);
    assert!(insert_paragraph(&mut tx)?);
    let children = tx.children_keys(NodeKey::ROOT)?;
    assert_eq!(children.len(), 2);
    assert_eq!(children[0], d.key());
    assert!(tx.is::<Paragraph>(children[1]));
    assert_eq!(tx.range_selection()?.anchor.key(), children[1]);
    Ok(())
}
#[test]
fn enter_on_inline_decorator_node_selection_is_unhandled() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<InlineDecorator>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let d = tx.create(InlineDecorator {})?;
    tx.append(p, &[d.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut nodes = NodeSelection::new();
    nodes.add(d);
    tx.set_selection(Some(Selection::Node(nodes)))?;
    assert!(!prepare_enter(
        &mut tx,
        &EscapeFormatTriggerConfig::default()
    )?);
    assert_eq!(tx.children_keys(p)?, vec![d.key()]);
    Ok(())
}
