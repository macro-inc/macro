use super::*;
use lexical_model::{ChildIndex, Editor, EditorMode, Paragraph, RangeSelection, Utf16Offset};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn string(value: &str) -> Value {
    Value::ForeignStringArgument {
        value: value.encode_utf16().collect(),
    }
}

// The parent authorizes issued references. These tests exercise the portable
// operation against real model keys, without replacing the graph or transaction.
fn reference(key: NodeKey) -> compat::ForeignNodeRef {
    compat::ForeignNodeRef {
        editor_id: 1,
        version: 0,
        key: compat::ForeignKey {
            index: key.index(),
            generation: key.generation(),
        },
        instance_owner_id: 0,
        class_id: 0,
        instance_id: 0,
    }
}

fn view_target(key: NodeKey, start: u32, end: u32) -> Vec<Value> {
    vec![
        Value::ForeignBooleanArgument { value: true },
        Value::ForeignNodeArrayArgument {
            values: vec![reference(key), reference(key)],
        },
        Value::ForeignNumberArrayArgument {
            values: vec![f64::from(start), 0.0, f64::from(end), 0.0, 0.0, 1.0],
        },
    ]
}

#[test]
fn detached_queries_use_the_supplied_graph_without_replacing_active_selection() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let active = Point::text(text, Utf16Offset(0));
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(active))))?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(4)),
    )));
    let SelectionOpResult::Nodes(nodes) = apply(&mut tx, slot, Op::SelectionGetNodes, &[])? else {
        panic!("expected nodes");
    };
    assert_eq!(nodes, vec![text.key()]);
    let SelectionOpResult::Scalar(Value::ForeignStringArgument { value }) =
        apply(&mut tx, slot, Op::SelectionGetTextContent, &[])?
    else {
        panic!("expected text");
    };
    assert_eq!(String::from_utf16(&value)?, "bcd");
    assert!(matches!(
        apply(&mut tx, slot, Op::SelectionIsCollapsed, &[])?,
        SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value: false })
    ));
    assert!(matches!(
        apply(&mut tx, slot, Op::SelectionIsBackward, &[])?,
        SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value: false })
    ));
    assert_eq!(tx.anchor()?, active);
    assert_eq!(tx.focus()?, active);
    assert_eq!(tx.view().text_content(NodeKey::ROOT), "abcdef");
    Ok(())
}

#[test]
fn detached_insert_and_format_keep_pinned_global_side_effects() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?;
    let active_text = tx.create_text("active")?;
    let second = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(first, &[active_text.key()])?;
    tx.append(second, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
    let active = Point::text(active_text, Utf16Offset(2));
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(active))))?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(4)),
    )));
    apply(&mut tx, slot, Op::SelectionFormatText, &[string("bold")])?;
    assert!(matches!(
        apply(&mut tx, slot, Op::SelectionHasFormat, &[string("bold")])?,
        SelectionOpResult::Scalar(Value::ForeignBooleanArgument { value: true })
    ));
    assert_eq!(tx.anchor()?, active);
    apply(&mut tx, slot, Op::SelectionInsertText, &[string("Ω")])?;
    assert_eq!(tx.view().text_content(second), "aΩef");
    assert_eq!(tx.anchor()?.offset(), 1);
    assert_eq!(tx.anchor()?.key(), tx.anchor_at(slot)?.key());
    assert_eq!(tx.focus()?, tx.anchor()?);
    assert_eq!(tx.anchor_at(slot)?.offset(), 0);
    assert_eq!(tx.focus_at(slot)?.offset(), 3);
    Ok(())
}

#[test]
fn typed_targets_drive_character_word_and_line_deletion_without_segmentation() -> TestResult {
    for (operation, start, expected) in [
        (Op::SelectionDeleteCharacter, 6, "abc de"),
        (Op::SelectionDeleteWord, 4, "abc "),
        (Op::SelectionDeleteLine, 4, "abc "),
    ] {
        let mut editor = Editor::builder(EditorMode::Headless).build()?;
        let mut tx = editor.transaction();
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc def")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
            text,
            Utf16Offset(7),
        ))));
        let mut args = view_target(text.key(), start, 7);
        if operation != Op::SelectionDeleteCharacter {
            args.extend(view_target(text.key(), 6, 7).into_iter().skip(1));
        }
        apply(&mut tx, slot, operation, &args)?;
        assert_eq!(tx.view().text_content(p), expected);
        assert!(tx.selection_at(SelectionSlot::Active)?.is_none());
    }
    Ok(())
}

#[test]
fn browser_utf16_half_surrogate_target_removes_the_complete_scalar() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("A😀B")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(3),
    ))));
    apply(
        &mut tx,
        slot,
        Op::SelectionDeleteCharacter,
        &view_target(text.key(), 2, 3),
    )?;
    assert_eq!(tx.view().text_content(p), "AB");
    Ok(())
}

#[test]
fn ordinary_collapsed_text_requires_layout_but_selected_text_does_not() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("hello")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(3),
    ))));
    for operation in [
        Op::SelectionDeleteCharacter,
        Op::SelectionDeleteWord,
        Op::SelectionDeleteLine,
    ] {
        assert!(matches!(
            apply(
                &mut tx,
                slot,
                operation,
                &[Value::ForeignBooleanArgument { value: true }]
            ),
            Err(BoundaryError::Model(Error::LayoutRequired))
        ));
    }
    assert_eq!(tx.view().text_content(p), "hello");
    let selected = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(4)),
    )));
    apply(
        &mut tx,
        selected,
        Op::SelectionDeleteCharacter,
        &[Value::ForeignBooleanArgument { value: false }],
    )?;
    assert_eq!(tx.view().text_content(p), "ho");
    Ok(())
}

#[test]
fn detached_select_start_linebreak_keeps_pinned_global_side_effects() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let a = tx.create(Paragraph::default())?;
    let active_text = tx.create_text("active")?;
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("ab")?;
    tx.append(a, &[active_text.key()])?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[a.key(), p.key()])?;
    let active = Point::text(active_text, Utf16Offset(2));
    tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(active))))?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(1),
    ))));
    apply(
        &mut tx,
        slot,
        Op::SelectionInsertLineBreak,
        &[Value::ForeignBooleanArgument { value: true }],
    )?;
    assert_eq!(tx.view().text_content(p), "ab\n");
    assert_eq!(tx.anchor()?, Point::element(p, ChildIndex(1)));
    assert_eq!(tx.focus()?, Point::element(p, ChildIndex(1)));
    assert_eq!(tx.anchor_at(slot)?, Point::text(text, Utf16Offset(1)));
    assert_eq!(tx.focus_at(slot)?, Point::text(text, Utf16Offset(1)));
    Ok(())
}

#[test]
fn malformed_target_numbers_are_rejected_before_graph_or_value_changes() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("hello")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let point = Point::text(text, Utf16Offset(5));
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(point)));
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        -1.0,
        0.5,
        f64::from(u32::MAX) + 1.0,
    ] {
        let args = [
            Value::ForeignBooleanArgument { value: true },
            Value::ForeignNodeArrayArgument {
                values: vec![reference(text.key()), reference(text.key())],
            },
            Value::ForeignNumberArrayArgument {
                values: vec![invalid, 0.0, 5.0, 0.0, 0.0, 1.0],
            },
        ];
        assert!(apply(&mut tx, slot, Op::SelectionDeleteCharacter, &args).is_err());
        assert_eq!(tx.view().text_content(p), "hello");
        assert_eq!(tx.anchor_at(slot)?, point);
        assert_eq!(tx.focus_at(slot)?, point);
    }
    assert!(apply(
        &mut tx,
        slot,
        Op::SelectionInsertText,
        &[Value::ForeignStringArgument {
            value: vec![0xd800]
        }]
    )
    .is_err());
    assert_eq!(tx.view().text_content(p), "hello");
    for values in [
        vec![4.0, 0.0, 5.0, 0.0, 0.0],
        vec![4.0, 0.0, 5.0, 0.0, 0.0, 1.0, 0.0],
        vec![4.0, 2.0, 5.0, 0.0, 0.0, 1.0],
        vec![4.0, 0.0, 5.0, 2.0, 0.0, 1.0],
        vec![4.0, 0.0, 5.0, 0.0, 2.0, 1.0],
        vec![4.0, 0.0, 5.0, 0.0, 0.0, 2.0],
    ] {
        let args = [
            Value::ForeignBooleanArgument { value: true },
            Value::ForeignNodeArrayArgument {
                values: vec![reference(text.key()), reference(text.key())],
            },
            Value::ForeignNumberArrayArgument { values },
        ];
        assert!(apply(&mut tx, slot, Op::SelectionDeleteCharacter, &args).is_err());
        assert_eq!(tx.view().text_content(p), "hello");
        assert_eq!(tx.anchor_at(slot)?, point);
    }
    for count in [0, 1, 3] {
        let args = [
            Value::ForeignBooleanArgument { value: true },
            Value::ForeignNodeArrayArgument {
                values: vec![reference(text.key()); count],
            },
            Value::ForeignNumberArrayArgument {
                values: vec![4.0, 0.0, 5.0, 0.0, 0.0, 1.0],
            },
        ];
        assert!(apply(&mut tx, slot, Op::SelectionDeleteCharacter, &args).is_err());
        assert_eq!(tx.view().text_content(p), "hello");
    }
    Ok(())
}

#[test]
fn inserted_node_keys_are_decoded_and_the_source_global_caret_is_selected() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcd")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let inserted = tx.create_text("X")?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(2),
    ))));
    let result = apply(
        &mut tx,
        slot,
        Op::SelectionInsertNodes,
        &[Value::ForeignNodeArrayArgument {
            values: vec![reference(inserted.key())],
        }],
    )?;
    assert!(matches!(result, SelectionOpResult::None));
    assert_eq!(tx.view().text_content(p), "abXcd");
    assert_eq!(tx.anchor()?, Point::text(inserted, Utf16Offset(1)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    Ok(())
}

#[test]
fn root_paragraph_insertion_returns_one_key_and_selects_it_globally() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let point = Point::element(NodeKey::ROOT, ChildIndex(1));
    let slot = tx.detach_selection(Selection::Range(RangeSelection::collapsed(point)));
    let SelectionOpResult::Nodes(nodes) = apply(&mut tx, slot, Op::SelectionInsertParagraph, &[])?
    else {
        panic!("expected nullable paragraph key");
    };
    let [inserted] = nodes.as_slice() else {
        panic!("expected one paragraph");
    };
    assert_eq!(
        tx.view().children(NodeKey::ROOT).collect::<Vec<_>>(),
        vec![p.key(), *inserted]
    );
    assert_eq!(tx.anchor()?, Point::element(*inserted, ChildIndex(0)));
    assert_eq!(tx.focus()?, tx.anchor()?);
    assert_eq!(tx.anchor_at(slot)?, point);
    Ok(())
}

#[test]
fn extract_splits_the_selected_text_without_removing_its_content() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(4)),
    )));
    let SelectionOpResult::Nodes(nodes) = apply(&mut tx, slot, Op::SelectionExtract, &[])? else {
        panic!("expected extracted keys");
    };
    let [selected] = nodes.as_slice() else {
        panic!("expected one selected text");
    };
    assert_eq!(tx.view().text_content(*selected), "bcd");
    assert_eq!(tx.view().text_content(p), "abcdef");
    assert!(tx.view().is_attached(*selected));
    Ok(())
}
