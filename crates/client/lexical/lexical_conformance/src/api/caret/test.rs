use super::*;

#[test]
fn caret_range_latest_and_slice_properties_preserve_object_identity() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    let mut tx = editor.transaction();
    let mut r = Replayer::default();
    let child = put(
        &mut r,
        tx.view(),
        CaretValue::Point(
            ChildCaret::new(tx.view(), p.key(), CaretDirection::Next)
                .expect("element")
                .into(),
        ),
    )?;
    assert_eq!(call(&mut r, &mut tx, &child, "getChildCaret", &[])?, child);
    let anchor = put(
        &mut r,
        tx.view(),
        CaretValue::Point(
            TextPointCaret::new(
                tx.view(),
                text.key(),
                CaretDirection::Next,
                TextOffsetSpec::At(Utf16Offset(1)),
            )?
            .into(),
        ),
    )?;
    let focus = put(
        &mut r,
        tx.view(),
        CaretValue::Point(
            TextPointCaret::new(
                tx.view(),
                text.key(),
                CaretDirection::Next,
                TextOffsetSpec::At(Utf16Offset(3)),
            )?
            .into(),
        ),
    )?;
    let range = call(
        &mut r,
        &mut tx,
        &Value::Null,
        "$getCaretRange",
        &[anchor.clone(), focus],
    )?;
    assert_eq!(call(&mut r, &mut tx, &range, "getLatest", &[])?, range);
    let slices = call(&mut r, &mut tx, &range, "getTextSlices", &[])?;
    assert_eq!(slices[0]["distance"], json!(2));
    assert_eq!(call(&mut r, &mut tx, &slices[0], "get:caret", &[])?, anchor);
    assert_eq!(call(&mut r, &mut tx, &slices[0], "get:caret", &[])?, anchor);
    tx.text(text)?.set_text_content("abcde")?;
    let latest = call(&mut r, &mut tx, &range, "getLatest", &[])?;
    assert_ne!(latest, range);
    let new_anchor = call(&mut r, &mut tx, &latest, "get:anchor", &[])?;
    assert_ne!(new_anchor, anchor);
    assert_eq!(
        call(&mut r, &mut tx, &new_anchor, "get:offset", &[])?,
        json!(1)
    );
    assert_eq!(call(&mut r, &mut tx, &latest, "getLatest", &[])?, latest);
    Ok(())
}

#[test]
fn iterator_captures_first_position_and_origin_before_later_sibling_insertion() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p)
    })?;
    let mut tx = editor.transaction();
    let mut r = Replayer::default();
    let origin = r.node(tx.view(), p.key())?;
    let range = put(
        &mut r,
        tx.view(),
        CaretValue::Range(CaretRange::new(
            ChildCaret::new(tx.view(), NodeKey::ROOT, CaretDirection::Next)
                .expect("root")
                .into(),
            SiblingCaret::new(p.key(), CaretDirection::Next).into(),
        )?),
    )?;
    let iterator = call(&mut r, &mut tx, &range, "iterNodeCarets", &[])?;
    let prefix = tx.create(Paragraph::default())?;
    tx.insert_before(p, prefix, true)?;
    let values = call(&mut r, &mut tx, &iterator, "iter", &[])?;
    assert_eq!(values[0]["origin"], origin);
    assert_eq!(values[0]["type"], json!("child"));
    assert!(
        values
            .as_array()
            .expect("carets")
            .iter()
            .all(|value| value["origin"]["$node"] != json!(prefix.key().index()))
    );
    assert_eq!(call(&mut r, &mut tx, &iterator, "iter", &[])?, json!([]));
    Ok(())
}
