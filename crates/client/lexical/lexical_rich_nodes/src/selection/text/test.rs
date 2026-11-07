use super::*;
#[test]
fn style_patch_splits_backward_selection_and_skips_stored_highlights() -> Result<(), Error> {
    let mut editor = crate::code::register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let a = tx.create_text("abc😀def")?;
        tx.append(p, &[a.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(a)?;
        tx.set_text_node_range(a, Utf16Offset(5), a, Utf16Offset(3))?;
        let patch = StylePatch::from([("color".into(), StylePatchValue::Set("red".into()))]);
        patch_style_text(tx, SelectionSlot::Active, &patch)?;
        let nodes = tx.children_keys(p)?;
        assert_eq!(nodes.len(), 3);
        let selected = nodes[1];
        assert_eq!(tx.text_content(selected), "😀");
        assert_eq!(tx.text_data(selected)?.style.as_ref(), "color: red;");
        assert!(!tx.range_selection()?.is_backward(tx.view())?);
        assert_eq!(
            get_selection_style_value_for_property(
                tx.view(),
                tx.selection().unwrap(),
                "color",
                ""
            )?,
            "red"
        );
        let selection = Selection::Range(RangeSelection::new(
            Point::text(selected, Utf16Offset(0)),
            Point::text(selected, Utf16Offset(2)),
        ));
        assert_eq!(
            slice_selected_text_node_content(tx.view(), &selection, selected)?,
            "😀"
        );
        Ok(())
    })?;
    Ok(())
}
#[test]
fn detached_collapsed_style_and_active_text_are_patched_separately() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let a = tx.create_text("a")?;
        let empty = tx.create(Paragraph {})?;
        tx.append(p, &[a.key()])?;
        tx.append(NodeKey::ROOT, &[p.key(), empty.key()])?;
        tx.select_start(a)?;
        tx.set_text_node_range(a, Utf16Offset(0), a, Utf16Offset(1))?;
        let point = Point::element(empty, ChildIndex(0));
        let slot = tx.detach_selection(Selection::Range(RangeSelection::new(point, point)));
        let patch = StylePatch::from([(
            "x".into(),
            StylePatchValue::Compute(Box::new(|previous, _| previous.unwrap_or("new").to_owned())),
        )]);
        patch_style_text(tx, slot, &patch)?;
        assert_eq!(tx.range_at(slot)?.style.as_ref(), "x: new;");
        assert_eq!(tx.element_data(empty)?.text_style.as_ref(), "x: new;");
        assert_eq!(tx.text_data(a)?.style.as_ref(), "x: new;");
        Ok(())
    })?;
    Ok(())
}
