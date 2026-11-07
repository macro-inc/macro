use crate::*;
use std::cell::RefCell;
thread_local! { static EVENTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) }; }
fn log<Node: NodeType>(_: &mut Transaction<'_>, node: Id<Node>) -> Result<(), Error> {
    EVENTS.with(|events| {
        events
            .borrow_mut()
            .push(format!("{} {}", Node::TYPE, node.key()))
    });
    Ok(())
}
fn oscillate(tx: &mut Transaction<'_>, node: Id<Text>) -> Result<(), Error> {
    let text = if tx.text_content(node) == "a" {
        "b"
    } else {
        "a"
    };
    tx.text(node)?.set_text_content(text)?;
    Ok(())
}
fn queued(tx: &mut Transaction<'_>) -> Result<(), Error> {
    tx.add_tag(UpdateTag::Paste);
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])
}
#[test]
fn root_transform_runs_last_s1_18_3() -> Result<(), Error> {
    EVENTS.with(|events| events.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Root>(log::<Root>)
        .transform::<Paragraph>(log::<Paragraph>)
        .transform::<Text>(log::<Text>)
        .build()
        .expect("registered transforms");
    let ((paragraph, first, second), commit) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let first = tx.create_text("first")?;
        tx.text(first)?.set_mode(TextMode::Token)?;
        let second = tx.create_text("second")?;
        tx.text(second)?.set_mode(TextMode::Token)?;
        tx.append(paragraph, &[first.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok((paragraph, first, second))
    })?;
    EVENTS.with(|events| {
        assert_eq!(
            *events.borrow(),
            vec![
                format!("text {}", first.key()),
                format!("text {}", second.key()),
                format!("paragraph {}", paragraph.key()),
                "root root".into()
            ]
        )
    });
    assert_eq!(
        commit.mutations_of::<Text>().collect::<Vec<_>>(),
        vec![
            (first.key(), Mutation::Created),
            (second.key(), Mutation::Created)
        ]
    );
    assert_eq!(commit.id, CommitId(1));
    assert!(commit.text_content_changed());
    Ok(())
}
#[test]
fn non_converging_transform_rolls_back_after_one_hundred_passes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(oscillate)
        .build()
        .expect("builder");
    let previous = editor.state().clone();
    let result = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])
    });
    assert!(matches!(result, Err(Error::InfiniteTransforms)));
    assert!(editor.state().same_snapshot(&previous));
    Ok(())
}
#[test]
fn normalization_merges_asymmetrically_and_collects_detached_subtrees() -> Result<(), Error> {
    static LABEL: StateKey<String> = StateKey::new("label", |value| {
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .into()
    });
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((p, first, second, orphan, orphan_child), commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("left")?;
        let second = tx.create_text("right")?;
        tx.set_state(second, &LABEL, "right state".into())?;
        tx.append(p, &[first.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let orphan = tx.create(Paragraph::default())?;
        let orphan_child = tx.create_text("orphan")?;
        tx.append(orphan, &[orphan_child.key()])?;
        Ok((p, first, second, orphan, orphan_child))
    })?;
    assert_eq!(
        commit.next.view().children(p).collect::<Vec<_>>(),
        vec![first.key()]
    );
    assert_eq!(commit.next.view().text_content(first), "leftright");
    assert_eq!(commit.next.view().get_state(first, &LABEL)?, "");
    assert!(commit.next.view().node(second).is_none());
    assert!(commit.next.view().node(orphan).is_none());
    assert!(commit.next.view().node(orphan_child).is_none());
    assert!(commit.changes.dirty_leaves.contains(&orphan_child.key()));
    assert!(!commit.changes.dirty_elements.contains_key(&orphan.key()));
    assert_eq!(
        commit.normalized.iter().copied().collect::<Vec<_>>(),
        vec![first.key(), second.key()]
    );
    Ok(())
}
#[test]
fn left_state_prevents_merge_with_a_different_right_state() -> Result<(), Error> {
    static LABEL: StateKey<String> = StateKey::new("label", |value| {
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .into()
    });
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let first = tx.create_text("left")?;
        let second = tx.create_text("right")?;
        tx.set_state(first, &LABEL, "left state".into())?;
        tx.append(p, &[first.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.flush()?;
        assert_eq!(
            tx.children(p).collect::<Vec<_>>(),
            vec![first.key(), second.key()]
        );
        Ok(())
    })?;
    Ok(())
}
#[test]
fn flush_queue_options_and_commit_tag_carry() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction_with(UpdateOptions {
        skip_transforms: true,
        tags: TagSet::from_tags([UpdateTag::HistoryPush]),
    });
    tx.queue_update(queued, UpdateOptions::default());
    assert!(tx.options().skip_transforms);
    tx.flush_with(FlushMode::NormalizeOnly)?;
    assert!(tx.has_tag(&UpdateTag::Paste));
    assert_eq!(
        tx.tags().iter().collect::<Vec<_>>(),
        vec![&UpdateTag::HistoryPush, &UpdateTag::Paste]
    );
    let first = tx.commit()?;
    assert!(!first.is_noop());
    let (_, selection) = editor.update_with(
        UpdateOptions {
            tags: TagSet::from_tags([UpdateTag::HistoryMerge]),
            ..UpdateOptions::default()
        },
        |tx| {
            tx.set_selection(Some(Selection::Range(RangeSelection {
                anchor: Point::element(NodeKey::ROOT, ChildIndex(0)),
                focus: Point::element(NodeKey::ROOT, ChildIndex(0)),
                format: TextFormat::empty(),
                style: "".into(),
            })))
        },
    )?;
    assert!(selection.selection_changed);
    assert!(selection.changes.is_empty());
    let tx = editor.transaction();
    assert!(tx.has_tag(&UpdateTag::HistoryMerge));
    let noop = tx.commit()?;
    assert!(noop.is_noop());
    assert!(noop.next.same_snapshot(&noop.prev));
    assert!(!editor.transaction().has_tag(&UpdateTag::HistoryMerge));
    Ok(())
}
#[test]
fn paragraph_points_normalize_to_text_s1_18_1() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let first = tx.create_text("a")?;
    let second = tx.create_text("b")?;
    tx.append(p, &[first.key(), second.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut range = RangeSelection {
        anchor: Point::element(p, ChildIndex(0)),
        focus: Point::element(p, ChildIndex(2)),
        format: TextFormat::empty(),
        style: "".into(),
    };
    normalize_range_selection(tx.view(), &mut range)?;
    assert_eq!(range.anchor, Point::text(first, Utf16Offset(0)));
    assert_eq!(range.focus, Point::text(second, Utf16Offset(1)));
    let slot = tx.detach_selection(Selection::Range(RangeSelection {
        anchor: Point::element(p, ChildIndex(2)),
        focus: Point::element(p, ChildIndex(0)),
        format: TextFormat::empty(),
        style: "".into(),
    }));
    tx.normalize_selection_at(slot)?;
    assert_eq!(
        tx.range_at(slot).expect("range").anchor,
        Point::text(second, Utf16Offset(1))
    );
    tx.set_selection(Some(Selection::Range(range.clone())))?;
    tx.normalize_selection()?;
    assert_eq!(tx.range_at(SelectionSlot::Active), Some(&range));
    Ok(())
}
#[test]
fn view_cache_changes_do_not_appear_as_mutations() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("builder");
    let ((p, text), first) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.text(text)?.set_format(TextFormat::BOLD)?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    assert_eq!(
        first.next.view().element(p).expect("paragraph").text_format,
        TextFormat::empty()
    );
    let (_, second) = editor.update(|tx| {
        tx.text(text)?.set_text_content("b")?;
        Ok(())
    })?;
    assert_eq!(
        second
            .changes
            .mutations
            .iter()
            .map(|(key, mutation)| (*key, *mutation))
            .collect::<Vec<_>>(),
        vec![(text.key(), Mutation::Updated)]
    );
    assert_eq!(
        second
            .next
            .view()
            .element(p)
            .expect("paragraph")
            .text_format,
        TextFormat::BOLD
    );
    assert_eq!(second.prev.view().text_content(text), "a");
    assert_eq!(second.next.view().text_content(text), "b");
    Ok(())
}
