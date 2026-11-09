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
    assert_eq!(
        result.expect_err("non-converging transform").to_string(),
        "One or more transforms are endlessly triggering additional transforms. May have encountered infinite recursion caused by transforms that have their preconditions too lose and/or conflict with each other."
    );
    assert!(editor.state().same_snapshot(&previous));
    Ok(())
}
#[test]
fn normalization_preserves_neighbor_state_and_collects_detached_subtrees() -> Result<(), Error> {
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
        vec![first.key(), second.key()]
    );
    assert_eq!(commit.next.view().text_content(first), "left");
    assert_eq!(commit.next.view().text_content(second), "right");
    assert_eq!(commit.next.view().get_state(second, &LABEL)?, "right state");
    assert_eq!(commit.next.view().get_state(first, &LABEL)?, "");
    assert!(commit.next.view().node(second).is_some());
    assert!(commit.next.view().node(orphan).is_none());
    assert!(commit.next.view().node(orphan_child).is_none());
    assert!(commit.changes.dirty_leaves.contains(&orphan_child.key()));
    assert!(!commit.changes.dirty_elements.contains_key(&orphan.key()));
    assert!(commit.normalized.is_empty());
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
    tx.queue_update(queued, UpdateOptions::default())?;
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
                cached_direction: None,
                dirty: false,
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
        cached_direction: None,
        dirty: false,
        anchor: Point::element(p, ChildIndex(0)),
        focus: Point::element(p, ChildIndex(2)),
        format: TextFormat::empty(),
        style: "".into(),
    };
    normalize_range_selection(tx.view(), &mut range)?;
    assert_eq!(range.anchor, Point::text(first, Utf16Offset(0)));
    assert_eq!(range.focus, Point::text(second, Utf16Offset(1)));
    let slot = tx.detach_selection(Selection::Range(RangeSelection {
        cached_direction: None,
        dirty: false,
        anchor: Point::element(p, ChildIndex(2)),
        focus: Point::element(p, ChildIndex(0)),
        format: TextFormat::empty(),
        style: "".into(),
    }));
    tx.normalize_selection_at(slot)?;
    assert_eq!(
        tx.try_range_at(slot).expect("range").anchor,
        Point::text(second, Utf16Offset(1))
    );
    tx.set_selection(Some(Selection::Range(range.clone())))?;
    tx.normalize_selection()?;
    assert_eq!(tx.try_range_at(SelectionSlot::Active), Some(&range));
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

#[test]
fn restore_compares_descendants_even_when_parent_records_are_shared() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let saved = editor.state().clone();
    editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    let restored =
        editor.set_editor_state(saved.clone(), TagSet::from_tags([UpdateTag::Historic]))?;
    assert!(restored.full_reconcile);
    assert_eq!(
        restored.mutations_of::<Text>().collect::<Vec<_>>(),
        vec![(text.key(), Mutation::Updated)]
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "before");
    let mut tx = editor.transaction();
    tx.text(text)?.set_text_content("early")?;
    tx.set_editor_state(saved, TagSet::default())?;
    assert_eq!(tx.text_content(text), "before");
    assert!(matches!(
        tx.text(text)?.set_text_content("forbidden"),
        Err(Error::WriteAfterSetEditorState)
    ));
    assert!(matches!(
        tx.set_selection(None),
        Err(Error::WriteAfterSetEditorState)
    ));
    assert!(matches!(
        tx.queue_update(queued, UpdateOptions::default()),
        Err(Error::WriteAfterSetEditorState)
    ));
    let commit = tx.commit()?;
    assert_eq!(commit.chain().count(), 2);
    assert_eq!(
        commit
            .preceding
            .as_ref()
            .expect("early commit")
            .next
            .root_text_content()
            .as_ref(),
        "early"
    );
    assert_eq!(commit.next.root_text_content().as_ref(), "before");
    Ok(())
}

#[test]
fn no_op_explicit_selection_and_composition_changes_are_reported() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abc")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(text)?.select(Some(Utf16Offset(1)), None)?;
        Ok(text)
    })?;
    let selection = editor.state().selection().cloned();
    let (_, commit) = editor.update(|tx| tx.set_selection(selection))?;
    assert!(commit.selection_changed);
    assert!(!commit.is_noop());
    let (_, commit) = editor.update(|tx| tx.set_composition_key(Some(text.key())))?;
    assert!(commit.composition_changed);
    assert_eq!(commit.composition_key, Some(text.key()));
    let before = editor.state().clone();
    let result: Result<((), Commit), Error> = editor.try_update(UpdateOptions::default(), |tx| {
        tx.set_composition_key(None)?;
        Err(Error::Invariant("rollback"))
    });
    assert!(result.is_err());
    assert!(editor.state().same_snapshot(&before));
    assert_eq!(editor.transaction().composition_key(), Some(text.key()));
    Ok(())
}

#[test]
fn explicit_full_reconcile_and_destroyed_mutations_compare_both_snapshots() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("destroyed")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.remove(p, false)?;
        tx.request_full_reconcile();
        Ok(())
    })?;
    assert!(commit.full_reconcile);
    assert_eq!(
        commit.mutations_of::<Text>().collect::<Vec<_>>(),
        vec![(text.key(), Mutation::Destroyed)]
    );
    assert_eq!(
        commit.mutations_of::<Paragraph>().collect::<Vec<_>>(),
        vec![(p.key(), Mutation::Destroyed)]
    );
    assert!(commit.next.view().node(text).is_none());
    Ok(())
}
#[test]
fn missing_text_endpoint_fails_before_gc_and_empty_node_selection_clears() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let missing = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 999,
    });
    let result = editor.update(|tx| {
        tx.set_selection(Some(Selection::Range(RangeSelection {
            cached_direction: None,
            dirty: false,
            anchor: Point::text(missing, Utf16Offset(0)),
            focus: Point::text(missing, Utf16Offset(0)),
            format: TextFormat::empty(),
            style: "".into(),
        })))
    });
    assert!(matches!(result,Err(Error::PointNodeNotFound(key)) if key == missing));
    let (_, commit) =
        editor.update(|tx| tx.set_selection(Some(Selection::Node(NodeSelection::default()))))?;
    assert!(commit.next.selection().is_none());
    Ok(())
}
#[test]
fn repeated_flushes_revisit_full_dirty_sets_but_commit_does_not_repeat_them() -> Result<(), Error> {
    EVENTS.with(|events| events.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Root>(log::<Root>)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.flush()?;
    tx.flush()?;
    tx.commit()?;
    EVENTS.with(|events| assert_eq!(*events.borrow(), vec!["root root", "root root"]));
    Ok(())
}
#[test]
fn normalize_only_skips_registered_transforms_but_merges_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(oscillate)
        .build()
        .expect("builder");
    let (_, commit) = editor.update_with(
        UpdateOptions {
            skip_transforms: true,
            ..UpdateOptions::default()
        },
        |tx| {
            let p = tx.create(Paragraph::default())?;
            let a = tx.create_text("a")?;
            let b = tx.create_text("b")?;
            tx.append(p, &[a.key(), b.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])
        },
    )?;
    assert_eq!(commit.next.root_text_content().as_ref(), "ab");
    assert_eq!(commit.normalized.len(), 2);
    Ok(())
}
#[test]
fn empty_editor_state_and_foreign_registry_are_rejected() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let empty = editor.state().clone();
    assert!(matches!(
        editor.set_editor_state(empty, TagSet::default()),
        Err(Error::SetEmptyEditorState)
    ));
    let other = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    assert!(matches!(
        editor.set_editor_state(other.state().clone(), TagSet::default()),
        Err(Error::ForeignEditorState)
    ));
    Ok(())
}

#[test]
fn shared_key_source_also_orders_commits_across_editors() -> Result<(), Error> {
    let keys = SharedKeyCounter::new();
    let mut a = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .build()
        .expect("a");
    let mut b = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .build()
        .expect("b");
    assert_eq!(a.transaction().commit()?.id, CommitId(1));
    assert_eq!(b.transaction().commit()?.id, CommitId(2));
    assert_eq!(a.transaction().commit()?.id, CommitId(3));
    Ok(())
}

#[test]
fn normalizing_an_unchanged_selection_keeps_the_commit_noop() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("text")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(t)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))
    })?;
    let (_, commit) = editor.update(|tx| tx.normalize_selection())?;
    assert!(commit.is_noop());
    assert!(!commit.selection_changed);
    Ok(())
}

fn queue_text_from_transform(tx: &mut Transaction<'_>, _: Id<Root>) -> Result<(), Error> {
    tx.queue_update(
        |tx| {
            let paragraph = tx.first_child(NodeKey::ROOT).expect("paragraph");
            let a = tx.create_text("a")?;
            let b = tx.create_text("b")?;
            tx.append(paragraph, &[a.key(), b.key()])
        },
        UpdateOptions::default(),
    )
}
#[test]
fn writes_queued_by_transforms_are_collected_without_a_second_transform_pass() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Root>(queue_text_from_transform)
        .build()
        .expect("builder");
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    assert_eq!(commit.next.view().all_text_nodes(NodeKey::ROOT).count(), 2);
    assert_eq!(commit.next.root_text_content().as_ref(), "ab");
    assert!(commit.normalized.is_empty());
    Ok(())
}
fn clear_composition(tx: &mut Transaction<'_>, node: Id<Text>) -> Result<(), Error> {
    if tx.text_content(node) == "a" {
        tx.set_composition_key(None)?;
    }
    EVENTS.with(|events| events.borrow_mut().push(tx.text_content(node).into_owned()));
    Ok(())
}
#[test]
fn transforms_keep_the_composition_key_captured_at_loop_entry() -> Result<(), Error> {
    EVENTS.with(|events| events.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(clear_composition)
        .build()
        .expect("builder");
    let (_, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        tx.text(a)?.set_mode(TextMode::Token)?;
        tx.text(b)?.set_mode(TextMode::Token)?;
        tx.append(p, &[a.key(), b.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_composition_key(Some(b.key()))
    })?;
    EVENTS.with(|events| assert_eq!(*events.borrow(), vec!["a"]));
    assert_eq!(commit.composition_key, None);
    Ok(())
}
#[test]
fn normal_mutations_use_dirty_keys_even_when_gc_deletes_clean_descendants() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("nested")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    let (_, commit) = editor.update(|tx| tx.remove(p, false))?;
    assert!(commit.next.view().node(text).is_none());
    assert_eq!(
        commit.mutations_of::<Paragraph>().collect::<Vec<_>>(),
        vec![(p.key(), Mutation::Destroyed)]
    );
    assert!(commit.mutations_of::<Text>().next().is_none());
    Ok(())
}

#[test]
fn nested_skip_transforms_applies_only_to_that_flush() -> Result<(), Error> {
    EVENTS.with(|events| events.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(log::<Text>)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let t = tx.create_text("text")?;
    tx.append(p, &[t.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.queue_update(
        |_| Ok(()),
        UpdateOptions {
            skip_transforms: true,
            ..UpdateOptions::default()
        },
    )?;
    tx.flush()?;
    EVENTS.with(|events| assert!(events.borrow().is_empty()));
    assert!(!tx.options().skip_transforms);
    tx.flush()?;
    EVENTS.with(|events| assert_eq!(*events.borrow(), vec![format!("text {}", t.key())]));
    Ok(())
}

#[cfg(feature = "bench-counters")]
#[test]
fn editing_one_text_counts_only_its_record_clone_and_dirty_ancestors() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    assert_eq!(commit.work.nodes_cloned, 1);
    assert_eq!(commit.work.nodes_visited, 6);
    assert!(commit.work.bytes_allocated > 0);
    assert_eq!(commit.work.diff_ops, 0);
    Ok(())
}

/// upstream: reconciliation updates root cached text through getWritable,
/// after mutation reporting, and retains the intentional root dirty mark.
#[test]
fn root_cache_reconciliation_clones_the_root_after_text_changes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let (_, commit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("after")?;
        Ok(())
    })?;
    assert_eq!(commit.next.root_text_content().as_ref(), "after");
    assert_eq!(
        commit.changes.dirty_elements.get(&NodeKey::ROOT),
        Some(&DirtyIntent::Intentional)
    );
    assert!(!std::ptr::eq(
        commit.prev.view().node(NodeKey::ROOT).expect("root").base(),
        commit.next.view().node(NodeKey::ROOT).expect("root").base()
    ));
    assert!(!commit.changes.mutations.contains_key(&NodeKey::ROOT));
    Ok(())
}

#[test]
fn changed_element_text_cache_is_intentionally_dirty_after_mutation_reporting() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("ab")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_format(TextFormat::BOLD)?;
    let commit = tx.commit()?;
    assert_eq!(
        commit.next.view().element(p).expect("element").text_format,
        TextFormat::BOLD
    );
    assert_eq!(
        commit.changes.dirty_elements.get(&p.key()),
        Some(&DirtyIntent::Intentional)
    );
    assert!(!commit.changes.mutations.contains_key(&p.key()));
    Ok(())
}

#[test]
fn splice_does_not_dirty_a_sibling_whose_links_are_unchanged() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = tx.create_text("a")?;
    let first = tx.create(Tab {})?;
    let b = tx.create_text("b")?;
    tx.append(p, &[a.key(), first.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    let second = tx.create(Tab {})?;
    tx.splice(p, ChildIndex(2), 0, &[second.key()])?;
    let commit = tx.commit()?;
    assert!(!commit.changes.dirty_leaves.contains(&a.key()));
    assert!(commit.changes.dirty_leaves.contains(&first.key()));
    assert!(commit.changes.dirty_leaves.contains(&b.key()));
    assert!(commit.changes.dirty_leaves.contains(&second.key()));
    Ok(())
}

/// Upstream ElementNode.splice moves inserted nodes with removeFromParent,
/// leaving source element points available for package-level remapping.
#[test]
fn moving_children_keeps_source_element_offsets_for_explicit_remap() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let from = tx.create(Paragraph {})?;
    let to = tx.create(Paragraph {})?;
    let text = tx.create_text("text")?;
    tx.append(from, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[from.key(), to.key()])?;
    tx.element(from)?
        .select(Some(ChildIndex(0)), Some(ChildIndex(1)))?;
    tx.splice(to, ChildIndex(0), 0, &[text.key()])?;
    assert_eq!(
        tx.range_at(SelectionSlot::Active)?.focus,
        Point::element(from.key(), ChildIndex(1))
    );
    tx.set_point_at(
        SelectionSlot::Active,
        PointRole::Anchor,
        Point::element(to.key(), ChildIndex(0)),
    )?;
    tx.set_point_at(
        SelectionSlot::Active,
        PointRole::Focus,
        Point::element(to.key(), ChildIndex(1)),
    )?;
    tx.commit()?;
    Ok(())
}

#[test]
fn explicit_selection_replacement_reports_an_object_identity_boundary() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))?;
    let before = tx.selection().cloned();
    assert_eq!(tx.selection_replacements(), 0);
    tx.replace_selection(before.clone())?;
    assert_eq!(tx.selection_replacements(), 1);
    assert_eq!(tx.selection(), before.as_ref());
    Ok(())
}
#[test]
fn installing_a_snapshot_reconciles_existing_element_typing_attributes() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("plain")?;
        tx.element(p)?.set_text_format(TextFormat::BOLD)?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p.key())
    })?;
    editor.set_editor_state(editor.state().clone(), TagSet::default())?;
    assert_eq!(
        editor.state().view().element_data(p)?.text_format,
        TextFormat::empty()
    );
    Ok(())
}
