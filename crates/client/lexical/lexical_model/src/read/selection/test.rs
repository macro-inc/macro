use super::*;
use crate::test_work::{Measurement, force_legacy_selection_order};

fn read(
    view: StateRef<'_>,
    range: &RangeSelection,
    legacy: bool,
) -> Result<(Vec<NodeKey>, String), Error> {
    let _legacy = legacy.then(force_legacy_selection_order);
    Ok((view.selected_nodes(range)?, range.text_content(view)?))
}

#[test]
fn short_selection_reads_do_not_scan_unselected_document_prefixes() -> Result<(), Error> {
    let mut small_same = None;
    let mut small_cross = None;
    for size in [1, 2, 5000] {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let (keys, _) = editor.update(|tx| {
            let mut keys = Vec::new();
            for _ in 0..size {
                let paragraph = tx.create(Paragraph::default())?;
                let text = tx.create_text("0123456789abcdef")?;
                tx.append(paragraph, &[text.key()])?;
                tx.append(NodeKey::ROOT, &[paragraph.key()])?;
                keys.push(text.key());
            }
            Ok(keys)
        })?;
        let positions = if size == 5000 {
            vec![0, 2499, 4998]
        } else {
            vec![0]
        };
        for index in positions {
            for cross in [false, true] {
                if cross && size < 2 {
                    continue;
                }
                let anchor = Point::text(keys[index], Utf16Offset(if cross { 9 } else { 0 }));
                let focus = Point::text(
                    keys[if cross { index + 1 } else { index }],
                    Utf16Offset(if cross { 8 } else { 16 }),
                );
                for backward in [false, true] {
                    let range = if backward {
                        RangeSelection::new(focus, anchor)
                    } else {
                        RangeSelection::new(anchor, focus)
                    };
                    editor.update(|tx| tx.set_selection(Some(Selection::Range(range))))?;
                    let view = editor.state().view();
                    let old = {
                        let _legacy = force_legacy_selection_order();
                        view.selection_text_content()?
                    };
                    let count = Measurement::start();
                    let actual = view.selection_text_content()?;
                    let lookups = count.slot_lookups();
                    drop(count);
                    assert_eq!(actual, old);
                    assert_eq!(
                        actual,
                        if cross {
                            "9abcdef\n01234567"
                        } else {
                            "0123456789abcdef"
                        }
                    );
                    println!(
                        "size={size} index={index} cross={cross} backward={backward} raw_slot_lookups={lookups}"
                    );
                    if size == 1 {
                        small_same = Some(lookups);
                    }
                    if size == 2 && cross {
                        small_cross = Some(lookups);
                    }
                    if size == 5000 {
                        let small = if cross {
                            small_cross.expect("two-node control")
                        } else {
                            small_same.expect("one-node control")
                        };
                        assert!(
                            lookups <= small + 8,
                            "selected text work grew with document prefix: small={small}, actual={lookups}"
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct Inline {}
impl NodeType for Inline {
    const TYPE: &'static str = "selection-inline";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Inline {
    element_node_base!();
    fn is_inline(&self, _: ElementView<'_>) -> bool {
        true
    }
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct Shadow {}
impl NodeType for Shadow {
    const TYPE: &'static str = "selection-shadow";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Shadow {
    element_node_base!();
    fn is_shadow_root(&self, _: ElementView<'_>) -> bool {
        true
    }
}

#[test]
fn boundary_order_matches_legacy_for_nested_inline_shadow_detached_and_invalid_points()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .node::<Shadow>()
        .build()
        .expect("editor");
    editor.update(|tx| {
        let mut keys = vec![NodeKey::ROOT];
        for _ in 0..3 {
            let outer = tx.create(Paragraph::default())?;
            let before = tx.create_text("a😀b")?;
            let inline = tx.create(Inline::default())?;
            let middle = tx.create_text("cd")?;
            let after = tx.create_text("ef")?;
            tx.append(inline, &[middle.key()])?;
            tx.append(outer, &[before.key(), inline.key(), after.key()])?;
            tx.append(NodeKey::ROOT, &[outer.key()])?;
            keys.extend([
                outer.key(),
                before.key(),
                inline.key(),
                middle.key(),
                after.key(),
            ]);
        }
        let shadow = tx.create(Shadow::default())?;
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("shadow")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(shadow, &[paragraph.key()])?;
        tx.append(NodeKey::ROOT, &[shadow.key()])?;
        keys.extend([shadow.key(), paragraph.key(), text.key()]);
        // Different/detached roots remain observable in the pending graph.
        for _ in 0..2 {
            let detached = tx.create(Paragraph::default())?;
            let text = tx.create_text("detached")?;
            tx.append(detached, &[text.key()])?;
            keys.extend([detached.key(), text.key()]);
        }
        let view = tx.view();
        let mut points = Vec::new();
        for key in keys {
            if let Some(text) = view.text(key) {
                points.push(Point::text(key, Utf16Offset::ZERO));
                points.push(Point::text(key, text.text.utf16_len()));
            } else {
                points.push(Point::element(key, ChildIndex(0)));
                points.push(Point::element(key, ChildIndex(view.children_size(key))));
            }
        }
        points.push(Point::text(
            NodeKey::from_parts(KeyParts {
                generation: 0,
                index: u32::MAX,
            }),
            Utf16Offset::ZERO,
        ));
        points.push(Point::text(NodeKey::ROOT, Utf16Offset::ZERO));
        for anchor in &points {
            for focus in &points {
                let range = RangeSelection::new(*anchor, *focus);
                let old = read(view, &range, true);
                let actual = read(view, &range, false);
                match (old, actual) {
                    (Ok(old), Ok(actual)) => assert_eq!(actual, old, "{anchor:?} -> {focus:?}"),
                    (Err(old), Err(actual)) => {
                        assert_eq!(
                            std::mem::discriminant(&actual),
                            std::mem::discriminant(&old)
                        );
                        assert_eq!(actual.to_string(), old.to_string());
                    }
                    (old, actual) => panic!(
                        "boundary result changed {anchor:?} -> {focus:?}: {old:?} / {actual:?}"
                    ),
                }
            }
        }
        Ok(())
    })?;
    Ok(())
}

#[test]
fn legacy_selection_order_scope_restores_after_unwind() {
    assert!(!crate::test_work::legacy_selection_order());
    let result = std::panic::catch_unwind(|| {
        let _legacy = force_legacy_selection_order();
        assert!(crate::test_work::legacy_selection_order());
        panic!("scope unwind");
    });
    assert!(result.is_err());
    assert!(!crate::test_work::legacy_selection_order());
}
