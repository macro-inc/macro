use super::*;
#[test]
fn ids_preserve_duplicates_but_add_and_delete_only_one() {
    let mut mark = MarkNode {
        ids: vec!["a".into(), "a".into(), "b".into()],
    };
    mark.add_id("a");
    mark.add_id("c");
    mark.delete_id("a");
    mark.delete_id("missing");
    assert_eq!(mark.ids(), ["a", "b", "c"]);
    mark.set_ids(vec!["z".into(), "z".into()]);
    assert_eq!(
        serde_json::to_string(&mark).unwrap(),
        r#"{"ids":["z","z"]}"#
    );
}
#[test]
fn wrapping_splits_boundaries_and_line_breaks_then_unwraps() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MarkNode>()
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let a = tx.create_text("abc")?;
        let lb = tx.create(LineBreak {})?;
        let b = tx.create_text("def")?;
        tx.append(p, &[a.key(), lb.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_start(a)?;
        let range = RangeSelection::new(
            Point::text(b, Utf16Offset(2)),
            Point::text(a, Utf16Offset(1)),
        );
        wrap_selection_in_mark_node::<
            fn(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>,
        >(tx, &range, true, "id", None)?;
        assert_eq!(range.anchor, Point::text(b, Utf16Offset(2)));
        let children = tx.children_keys(p)?;
        assert_eq!(
            children
                .iter()
                .map(|key| tx.type_name(*key).unwrap())
                .collect::<Vec<_>>(),
            ["text", "mark", "linebreak", "mark", "text"]
        );
        let marks = children
            .into_iter()
            .filter(|key| is_mark_node(tx, *key))
            .collect::<Vec<_>>();
        let first = marks[0];
        let child = tx.children_keys(first)?[0];
        assert_eq!(tx.text_content(first), "bc");
        assert_eq!(
            get_mark_ids(tx, child, Utf16Offset(0)),
            Some(vec!["id".into()])
        );
        assert!(!tx.can_insert_text_before(first));
        assert!(tx.exclude_from_copy(first, Some(CopyDestination::Html)));
        assert!(!tx.exclude_from_copy(first, Some(CopyDestination::Clone)));
        for mark in marks {
            unwrap_mark_node(tx, mark)?;
        }
        assert_eq!(tx.text_content(p), "abc\ndef");
        Ok(())
    })?;
    Ok(())
}

// LexicalSelection.ts: clear protected inline parents before replacement.
#[test]
fn replacement_across_mark_boundary_leaves_new_text_outside_mark() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MarkNode>()
        .build()
        .unwrap();
    let ((paragraph, mark, marked, trailing), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let mark = tx.create(MarkNode {
            ids: vec!["annotation".into()],
        })?;
        let marked = tx.create_text("abc")?;
        let trailing = tx.create_text("def")?;
        tx.append(mark, &[marked.key()])?;
        tx.append(paragraph, &[mark.key(), trailing.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph, mark, marked, trailing))
    })?;
    editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(marked, Utf16Offset(0)),
            Point::text(trailing, Utf16Offset(1)),
        ))))?;
        tx.insert_text("x")
    })?;
    let state = editor.state();
    assert!(!state.is_attached(mark));
    assert_eq!(state.children_keys(paragraph)?.len(), 1);
    assert_eq!(state.text_content(paragraph).as_ref(), "xef");
    let selected = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(selected.anchor.offset(), 1);
    assert_eq!(selected.anchor, selected.focus);
    Ok(())
}

#[test]
fn typing_after_link_inside_mark_escapes_both_protected_parents() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MarkNode>()
        .node::<crate::link::LinkNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let mark = tx.create(MarkNode {
        ids: vec!["annotation".into()],
    })?;
    let link = crate::link::create_link_node(&mut tx, "/", Default::default())?;
    let text = tx.create_text("a")?;
    tx.append(link, &[text.key()])?;
    tx.append(mark, &[link.key()])?;
    tx.append(paragraph, &[mark.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.select_end(text)?;
    tx.insert_text("b")?;
    let children = tx.children_keys(paragraph)?;
    assert_eq!(children.len(), 2);
    assert_eq!(children[0], mark.key());
    assert_eq!(tx.text_content(mark), "a");
    assert!(tx.is_text(children[1]));
    assert_eq!(tx.text_content(children[1]), "b");
    Ok(())
}

#[test]
fn replacing_link_text_cleans_empty_link_before_escaping_mark() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MarkNode>()
        .node::<crate::link::LinkNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let prefix = tx.create_text("p")?;
    let mark = tx.create(MarkNode {
        ids: vec!["m".into()],
    })?;
    let link = crate::link::create_link_node(&mut tx, "/", Default::default())?;
    let selected = tx.create_text("x")?;
    let suffix = tx.create_text("y")?;
    tx.append(link, &[selected.key()])?;
    tx.append(mark, &[link.key(), suffix.key()])?;
    tx.append(paragraph, &[prefix.key(), mark.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.set_selection(Some(Selection::Range(RangeSelection::new(
        Point::text(selected, Utf16Offset(0)),
        Point::text(selected, Utf16Offset(1)),
    ))))?;
    tx.insert_text("z")?;
    tx.commit()?;
    let state = editor.state();
    assert_eq!(state.children_keys(paragraph)?, [prefix.key(), mark.key()]);
    assert_eq!(state.children_keys(mark)?, [suffix.key()]);
    assert_eq!(state.text_content(prefix).as_ref(), "pz");
    assert_eq!(
        state
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(prefix, Utf16Offset(2))
    );
    Ok(())
}
