use super::*;
// Literal ports of lexical-history stack/tag/selection behavior; the standalone
// getter cases also exercise MergeTracker without constructing History.

#[test]
fn upstream_history_starts_with_empty_stacks() {
    let history = History::new(HistoryConfig::default(), HistoryTime(0));
    assert_eq!(history.undo_depth(), 0);
    assert_eq!(history.redo_depth(), 0);
    assert_eq!(
        history.availability(),
        HistoryAvailability {
            can_undo: false,
            can_redo: false
        }
    );
    assert_eq!(
        history.config(),
        HistoryConfig {
            delay_ms: 300,
            max_depth: None
        }
    );
}

#[test]
fn upstream_first_commit_sets_current_without_undo_entry() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    assert_eq!(
        history.record(&initial, HistoryTime(1)),
        (HistoryAction::Push, None)
    );
    assert_eq!(history.undo_depth(), 0);
    assert_eq!(editor.state().view().text_content(text), "a");
}

#[test]
fn upstream_push_reports_can_undo() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.text(text)?.set_text_content("ab")?;
            tx.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(2)))?;
            tx.set_point(PointRole::Focus, Point::text(text, Utf16Offset(2)))
        })
        .unwrap();
    assert_eq!(
        history.record(&edit, HistoryTime(1)),
        (
            HistoryAction::Push,
            Some(HistoryAvailability {
                can_undo: true,
                can_redo: false
            })
        )
    );
    assert_eq!(history.undo_depth(), 1);
}

#[test]
fn upstream_repeated_commit_identity_is_a_noop() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    assert_eq!(
        history.record(&initial, HistoryTime(400)),
        (HistoryAction::Discard, None)
    );
    assert_eq!(history.undo_depth(), 0);
    assert_eq!(editor.state().view().text_content(text), "a");
}

#[test]
fn upstream_typing_merges_within_delay() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    tracker.classify(&initial, HistoryTime(0));
    let (_, first) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(1)..Utf16Offset(1), "b", true)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&first, HistoryTime(1)),
        HistoryAction::Push
    );
    let (_, second) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(2)..Utf16Offset(2), "c", true)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&second, HistoryTime(200)),
        HistoryAction::Merge
    );
}

#[test]
fn upstream_typing_at_delay_boundary_pushes() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, first) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(1)..Utf16Offset(1), "b", true)?;
            Ok(())
        })
        .unwrap();
    tracker.classify(&first, HistoryTime(1));
    let (_, second) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(2)..Utf16Offset(2), "c", true)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&second, HistoryTime(301)),
        HistoryAction::Push
    );
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_history_push_overrides_merge_tag() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryPush);
            tx.add_tag(UpdateTag::HistoryMerge);
            tx.text(text)?.set_text_content("abc")?;
            Ok(())
        })
        .unwrap();
    assert_eq!(tracker.classify(&edit, HistoryTime(1)), HistoryAction::Push);
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_history_merge_tag_overrides_composition_discard() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryMerge);
            tx.set_composition_key(Some(text))?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&edit, HistoryTime(1)),
        HistoryAction::Merge
    );
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_composition_discards_intermediate_updates() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryPush);
            tx.add_tag(UpdateTag::CompositionStart);
            tx.set_composition_key(Some(text))?;
            tx.text(text)?.set_text_content("composing")?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&edit, HistoryTime(1)),
        HistoryAction::Discard
    );
    let (_, end) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::CompositionEnd);
            tx.set_composition_key(None)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(tracker.classify(&end, HistoryTime(2)), HistoryAction::Push);
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_selection_only_merges_even_with_push_tag() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryPush);
            tx.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(0)))
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&edit, HistoryTime(1)),
        HistoryAction::Merge
    );
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_dirty_but_unchanged_text_merges_under_push_tag() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryPush);
            tx.mark_dirty(text)
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&edit, HistoryTime(1)),
        HistoryAction::Merge
    );
    assert_eq!(initial.next.view().text_content(text), "a");
}

#[test]
fn upstream_empty_undo_redo_still_leave_stacks_empty() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    assert!(history.undo(&mut editor, HistoryTime(1)).unwrap().is_none());
    assert!(history.redo(&mut editor, HistoryTime(2)).unwrap().is_none());
    let mut tx = editor.transaction();
    assert!(!history.undo_in(&mut tx).unwrap());
    assert!(!history.redo_in(&mut tx).unwrap());
}

#[test]
fn upstream_undo_redo_and_new_edit_clear_redo() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    let (_, edit) = editor
        .update(|tx| {
            tx.text(text)?.set_text_content("abc")?;
            Ok(())
        })
        .unwrap();
    history.record(&edit, HistoryTime(1));
    let undo = history.undo(&mut editor, HistoryTime(2)).unwrap().unwrap();
    assert!(undo.tags.contains(&UpdateTag::Historic));
    assert_eq!(editor.state().view().text_content(text), "a");
    assert_eq!(
        history.availability(),
        HistoryAvailability {
            can_undo: false,
            can_redo: true
        }
    );
    history.redo(&mut editor, HistoryTime(3)).unwrap().unwrap();
    assert_eq!(editor.state().view().text_content(text), "abc");
    assert_eq!(
        history.availability(),
        HistoryAvailability {
            can_undo: true,
            can_redo: false
        }
    );
    history.undo(&mut editor, HistoryTime(4)).unwrap().unwrap();
    let (_, edit) = editor
        .update(|tx| {
            tx.text(text)?.set_text_content("new")?;
            Ok(())
        })
        .unwrap();
    let (_, availability) = history.record(&edit, HistoryTime(5));
    assert_eq!(
        availability,
        Some(HistoryAvailability {
            can_undo: true,
            can_redo: false
        })
    );
}

#[test]
fn upstream_undo_then_type_within_delay_retains_undo_boundary() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    let (_, first) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(1)..Utf16Offset(1), "b", true)?;
            Ok(())
        })
        .unwrap();
    history.record(&first, HistoryTime(10));
    history.undo(&mut editor, HistoryTime(20)).unwrap().unwrap();
    let (_, second) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(1)..Utf16Offset(1), "c", true)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        history.record(&second, HistoryTime(30)).0,
        HistoryAction::Push
    );
    history.undo(&mut editor, HistoryTime(40)).unwrap().unwrap();
    assert_eq!(editor.state().view().text_content(text), "a");
}

#[test]
fn upstream_config_depth_evicts_only_on_next_push() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::with_stacks(
        HistoryConfig::default(),
        HistoryTime(0),
        Some(initial.next.clone()),
        vec![initial.next.clone(), initial.next.clone()],
        vec![initial.next.clone()],
    );
    history.set_config(HistoryConfig {
        delay_ms: 0,
        max_depth: NonZeroU32::new(1),
    });
    assert_eq!(history.undo_depth(), 2);
    assert_eq!(history.redo_depth(), 1);
    let (_, edit) = editor
        .update(|tx| {
            tx.text(text)?.set_text_content("different")?;
            Ok(())
        })
        .unwrap();
    history.record(&edit, HistoryTime(1));
    assert_eq!(history.undo_depth(), 1);
    assert_eq!(history.redo_depth(), 0);
    history.clear();
    assert_eq!(history.availability(), HistoryAvailability::default());
}

#[test]
fn upstream_undo_in_commits_pending_work_before_installing_snapshot() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut history = History::with_stacks(
        HistoryConfig::default(),
        HistoryTime(0),
        Some(initial.next.clone()),
        vec![initial.next.clone()],
        vec![],
    );
    let mut tx = editor.transaction();
    tx.text(text).unwrap().set_text_content("pending").unwrap();
    assert!(history.undo_in(&mut tx).unwrap());
    assert!(matches!(
        tx.mark_dirty(text),
        Err(Error::WriteAfterSetEditorState)
    ));
    let commit = tx.commit().unwrap();
    assert_eq!(commit.chain().count(), 2);
    assert_eq!(
        &*commit.preceding.as_ref().unwrap().next.root_text_content(),
        "pending"
    );
    assert_eq!(&*commit.next.root_text_content(), "a");
    for c in commit.chain() {
        history.record(c, HistoryTime(1));
    }
    let mut tx = editor.transaction();
    assert!(history.redo_in(&mut tx).unwrap());
    let redo = tx.commit().unwrap();
    for c in redo.chain() {
        history.record(c, HistoryTime(2));
    }
    assert_eq!(editor.state().view().text_content(text), "a");
}

#[test]
fn replacing_old_anchor_is_not_classified_as_first_character_typing() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let ((parent, text), initial) = editor
        .update(|tx| {
            let parent = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[parent.key()])?;
            tx.append(parent, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok((parent.key(), text.key()))
        })
        .unwrap();
    let mut tracker = MergeTracker::new(300, HistoryTime(0));
    tracker.classify(&initial, HistoryTime(0));
    let (_, typed) = editor
        .update(|tx| {
            tx.text(text)?
                .splice_text(Utf16Offset(1)..Utf16Offset(1), "b", true)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        tracker.classify(&typed, HistoryTime(1)),
        HistoryAction::Push
    );
    let (_, replaced) = editor
        .update(|tx| {
            let next = tx.create_text("x")?;
            tx.splice(parent, ChildIndex(0), 1, &[next.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(next, Utf16Offset(1)),
            ))))
        })
        .unwrap();
    assert!(!replaced.next.view().contains(text));
    assert_eq!(
        tracker.classify(&replaced, HistoryTime(2)),
        HistoryAction::Push
    );
}

static RESTORED: EventKey<()> = EventKey::new("restored");
struct NotifyRestored;
impl Plugin for NotifyRestored {
    fn name(&self) -> &'static str {
        "notify-restored"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        if commit.tags.contains(&UpdateTag::Historic) && !commit.changes.is_empty() {
            tx.emit(&RESTORED, ());
        }
        Ok(())
    }
}
#[test]
fn standalone_restore_publishes_notification_without_replacing_history_candidate()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(NotifyRestored)
        .build()
        .expect("editor");
    let (text, initial) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(text)
    })?;
    let mut history = History::new(HistoryConfig::default(), HistoryTime(0));
    history.record(&initial, HistoryTime(0));
    let (_, edit) = editor.update(|tx| {
        tx.text(text)?.set_text_content("abc")?;
        Ok(())
    })?;
    history.record(&edit, HistoryTime(1));
    let commit = history.undo(&mut editor, HistoryTime(2))?.expect("undo");
    assert_eq!(commit.chain().count(), 2);
    assert_eq!(
        commit.chain().flat_map(|c| c.events_of(&RESTORED)).count(),
        1
    );
    assert_eq!(editor.state().view().text_content(text), "a");
    assert_eq!(history.current_commit, None);
    assert_eq!(
        history.availability(),
        HistoryAvailability {
            can_undo: false,
            can_redo: true
        }
    );
    Ok(())
}
