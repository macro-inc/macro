use super::*;

#[test]
fn utf16_replacement_rejects_split_scalars_and_preserves_snapshot_atomically() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("a😀z")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            tx.select_end(text)?;
            Ok(text.key())
        })
        .expect("seed");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let previous = core.state().clone();
    let error = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(2),
                deleted: Utf16Offset(0),
                inserted: "x".into(),
                anchor: Some(Utf16Offset(3)),
                focus: Some(Utf16Offset(3)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(0)),
                    focus: Point::text(key, Utf16Offset(0)),
                    resolution_dirty: false,
                },
            }),
            HistoryTime(1),
        )
        .expect_err("split scalar");
    assert!(error.committed.is_empty());
    assert!(previous.same_snapshot(core.state()));
    assert_eq!(previous.selection(), core.state().selection());
    let output = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(1),
                deleted: Utf16Offset(2),
                inserted: "🦊b".into(),
                anchor: Some(Utf16Offset(4)),
                focus: Some(Utf16Offset(4)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(4)),
                    focus: Point::text(key, Utf16Offset(4)),
                    resolution_dirty: false,
                },
            }),
            HistoryTime(2),
        )
        .expect("replace scalar");
    assert_eq!(core.state().view().text_content(key), "a🦊bz");
    assert_eq!(previous.view().text_content(key), "a😀z");
    assert!(output.diff.ops.is_empty());
    assert_eq!(output.diff.view_text_matches, Some(key));
    let before = core.state().clone();
    let unchanged = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(1),
                deleted: Utf16Offset(2),
                inserted: "🦊".into(),
                anchor: Some(Utf16Offset(0)),
                focus: Some(Utf16Offset(0)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(0)),
                    focus: Point::text(key, Utf16Offset(0)),
                    resolution_dirty: false,
                },
            }),
            HistoryTime(3),
        )
        .expect("unchanged text");
    assert!(unchanged.commits.is_empty());
    assert_eq!(before.selection(), core.state().selection());
    assert_eq!(core.state().view().text_content(key), "a🦊bz");
}

#[test]
fn transformed_delta_corrects_view_and_batch_validation_uses_pending_text() {
    fn uppercase(tx: &mut Transaction<'_>, text: Id<Text>) -> Result<(), Error> {
        let old = tx.view().text_data(text)?.text.as_str();
        if old.contains('x') {
            let corrected = old.replace('x', "X");
            tx.text(text)?.set_text_content(&corrected)?;
        }
        Ok(())
    }
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .transform::<Text>(uppercase)
        .build()
        .expect("registry");
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("ab")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            tx.select_end(text)?;
            Ok(text.key())
        })
        .expect("seed");
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(1),
                deleted: Utf16Offset(0),
                inserted: "x".into(),
                anchor: Some(Utf16Offset(2)),
                focus: Some(Utf16Offset(2)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            }),
            HistoryTime(1),
        )
        .expect("transformed input");
    assert_eq!(output.diff.view_text_matches, None);
    assert_eq!(
        output.diff.ops,
        vec![DiffOp::Text {
            key,
            text: "aXb".into()
        }]
    );
    assert!(
        output
            .effects
            .iter()
            .any(|effect| matches!(effect, Effect::SetViewSelection { .. }))
    );
    let batch = core
        .apply(
            Input::Batch(vec![
                Input::TextDeltaFromView(ViewTextDelta {
                    key,
                    offset: Utf16Offset(3),
                    deleted: Utf16Offset(0),
                    inserted: "c".into(),
                    anchor: Some(Utf16Offset(4)),
                    focus: Some(Utf16Offset(4)),
                    composition_end: false,
                    composition_data: None,
                    selection: ViewSelection::KeepModel,
                }),
                Input::TextDeltaFromView(ViewTextDelta {
                    key,
                    offset: Utf16Offset(4),
                    deleted: Utf16Offset(0),
                    inserted: "d".into(),
                    anchor: Some(Utf16Offset(5)),
                    focus: Some(Utf16Offset(5)),
                    composition_end: false,
                    composition_data: None,
                    selection: ViewSelection::KeepModel,
                }),
            ]),
            HistoryTime(2),
        )
        .expect("batch deltas");
    // The existing dirty-leaf DOM guard ignores a second input in the same
    // transaction, but its offset was validated against the pending "aXbc".
    assert_eq!(core.state().view().text_content(key), "aXbc");
    assert_eq!(
        batch.diff.ops,
        vec![DiffOp::Text {
            key,
            text: "aXbc".into()
        }]
    );
}

#[test]
fn delta_keeps_typing_attributes_and_composition_end_history() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(3)));
        range.format = TextFormat::BOLD;
        range.style = "color: red".into();
        tx.set_selection(Some(Selection::Range(range)))?;
        Ok(text.key())
    })?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: Some(HistoryConfig::default()),
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(
        Input::TextDeltaFromView(ViewTextDelta {
            key,
            offset: Utf16Offset(3),
            deleted: Utf16Offset(0),
            inserted: "b".into(),
            anchor: Some(Utf16Offset(4)),
            focus: Some(Utf16Offset(4)),
            composition_end: false,
            composition_data: None,
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(4)),
                focus: Point::text(key, Utf16Offset(4)),
                resolution_dirty: false,
            },
        }),
        HistoryTime(1),
    )
    .expect("ordinary delta");
    let range = core
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.format, TextFormat::BOLD);
    assert_eq!(&*range.style, "color: red");
    assert_eq!(core.state().view().text_content(key), "a😀b");
    core.apply(
        Input::Composition {
            event: CompositionEvent::Start {
                data: String::new(),
            },
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(1000),
    )
    .expect("composition start");
    assert_eq!(core.composition(), Composition::Composing { key });
    let end = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(4),
                deleted: Utf16Offset(0),
                inserted: "語".into(),
                anchor: Some(Utf16Offset(5)),
                focus: Some(Utf16Offset(5)),
                composition_end: true,
                composition_data: Some("語".into()),
                selection: ViewSelection::KeepModel,
            }),
            HistoryTime(1001),
        )
        .expect("composition delta");
    assert_eq!(core.composition(), Composition::Idle);
    assert!(
        end.commits
            .iter()
            .any(|commit| commit.tags.contains(&UpdateTag::CompositionEnd))
    );
    assert_eq!(core.state().view().text_content(key), "a😀b語");
    core.apply(Input::Undo, HistoryTime(1002))
        .expect("undo composition");
    assert_eq!(core.state().view().text_content(key), "a😀b");
    core.apply(Input::Redo, HistoryTime(1003))
        .expect("redo composition");
    assert_eq!(core.state().view().text_content(key), "a😀b語");
    Ok(())
}

#[test]
fn delta_composition_newline_uses_the_existing_enter_policy() -> Result<(), Error> {
    struct Enter;
    impl Plugin for Enter {
        fn name(&self) -> &'static str {
            "delta-enter-test"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[CommandRegistration {
                command: CommandKind::Key(KeyCommand::Enter),
                priority: CommandPriority::Normal,
                placement: Placement::After,
            }]
        }
        fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
            if matches!(
                command,
                Command::Key {
                    command: KeyCommand::Enter,
                    ..
                }
            ) {
                tx.insert_text("!")?;
                Ok(Handled::Yes)
            } else {
                Ok(Handled::No)
            }
        }
    }
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Enter)
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("ab")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(text, Utf16Offset(0)),
            Point::text(text, Utf16Offset(2)),
        ))))?;
        tx.set_composition_key(Some(text.key()))?;
        Ok(text.key())
    })?;
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .apply(
            Input::TextDeltaFromView(ViewTextDelta {
                key,
                offset: Utf16Offset(2),
                deleted: Utf16Offset(0),
                inserted: "\n".into(),
                anchor: Some(Utf16Offset(3)),
                focus: Some(Utf16Offset(3)),
                composition_end: true,
                composition_data: Some("\n".into()),
                selection: ViewSelection::KeepModel,
            }),
            HistoryTime(1),
        )
        .expect("newline composition");
    assert_eq!(core.state().view().text_content(key), "ab!");
    assert_eq!(core.composition(), Composition::Idle);
    assert_eq!(output.diff.view_text_matches, None);
    assert!(
        output
            .commits
            .iter()
            .any(|commit| commit.tags.contains(&UpdateTag::CompositionEnd))
    );
    Ok(())
}
