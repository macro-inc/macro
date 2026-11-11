use super::*;
#[test]
fn keydown_routing_prevents_default_and_respects_lazy_view_selection() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(t, Utf16Offset(3)),
            ))))?;
            Ok(t.key())
        })
        .unwrap();
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
            Input::KeyDown {
                event: KeyEvent {
                    key: Arc::from("x"),
                    ..Default::default()
                },
                routed: Some(Command::InsertText("x".into())),
                routed_prevent_default: true,
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(1)),
                    focus: Point::text(text, Utf16Offset(1)),
                    resolution_dirty: false,
                },
            },
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(output.handled, Handled::Yes);
    assert_eq!(&*core.state().root_text_content(), "axbc");
    assert!(output.effects.contains(&Effect::PreventDefault));
    assert!(
        output
            .effects
            .iter()
            .any(|effect| matches!(effect, Effect::SetViewSelection { .. }))
    );
    core.set_editable(false);
    let output = core
        .apply(
            Input::Command {
                command: Command::InsertText("y".into()),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(2),
        )
        .unwrap();
    assert!(
        !output
            .effects
            .iter()
            .any(|effect| matches!(effect, Effect::SetViewSelection { .. }))
    );
}
#[test]
fn selection_from_view_elides_identical_dom_selection() {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
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
            Input::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(2)),
                    focus: Point::text(text, Utf16Offset(2)),
                    resolution_dirty: false,
                },
                change: None,
            },
            HistoryTime(0),
        )
        .unwrap();
    assert!(output.diff.ops.is_empty());
    assert!(output.effects.is_empty());
    assert_eq!(
        core.state().selection().unwrap().as_range().unwrap().anchor,
        Point::text(text, Utf16Offset(2))
    );
}
#[test]
fn browser_composition_characters_strip_by_platform_and_native_preserves_them() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .view_host(ViewHost {
            engine: ViewEngine::Firefox,
            os: ViewOs::Other,
        })
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(t, Utf16Offset(3)),
            ))))?;
            Ok(t.key())
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(
        Input::Composition {
            event: CompositionEvent::Start { data: "".into() },
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(1),
    )
    .unwrap();
    assert_eq!(core.composition(), Composition::Composing { key: text });
    core.apply(
        Input::Composition {
            event: CompositionEvent::End {
                key: text,
                text: "a\u{a0}bc\u{200b}".into(),
                anchor: Some(Utf16Offset(4)),
                focus: Some(Utf16Offset(4)),
                data: "abc".into(),
            },
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(2),
    )
    .unwrap();
    assert_eq!(&*core.state().root_text_content(), "abc");
    assert_eq!(core.composition(), Composition::Idle);
    let host = ViewHost {
        engine: ViewEngine::Native,
        os: ViewOs::Ios,
    };
    assert!(host.is_ios());
    assert!(host.is_apple());
    assert!(!host.is_android());
    assert!(
        ViewHost {
            engine: ViewEngine::Native,
            os: ViewOs::Android
        }
        .is_android()
    );
    let mut native = Editor::builder(EditorMode::ViewAttached)
        .view_host(host)
        .build()
        .unwrap();
    let (key, _) = native
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
    let mut native = EditorCore::new(
        native,
        CoreConfig {
            history: None,
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    native
        .apply(
            Input::TextFromView {
                key,
                text: "a\u{a0}\u{200b}".into(),
                anchor: None,
                focus: None,
                composition_end: true,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(0),
        )
        .unwrap();
    assert_eq!(&*native.state().root_text_content(), "a\u{a0}\u{200b}");
}
#[test]
fn insertion_policy_keeps_plain_typing_on_the_dom_fast_path() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(t, Utf16Offset(3)),
            ))))?;
            Ok(t.key())
        })
        .unwrap();
    let range = editor.state().selection().unwrap().as_range().unwrap();
    assert!(
        !editor
            .state()
            .should_prevent_default_and_insert_text(range, "x", InsertTextFacts::default())
            .unwrap()
    );
    assert!(
        editor
            .state()
            .should_prevent_default_and_insert_text(
                range,
                "x",
                InsertTextFacts {
                    target_range_mismatch: true,
                    ..Default::default()
                }
            )
            .unwrap()
    );
    assert!(editor.state().can_remove_text(text, text));
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
            Input::InsertTextEvent {
                phase: TextEventPhase::BeforeInput,
                data: Some("x".into()),
                data_transfer_text: None,
                facts: InsertTextFacts::default(),
                last_key: None,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(0),
        )
        .unwrap();
    assert!(output.diff.ops.is_empty());
    assert!(output.effects.is_empty());
    assert_eq!(output.handled, Handled::No);
    let output = core
        .apply(
            Input::InsertTextEvent {
                phase: TextEventPhase::BeforeInput,
                data: Some("x".into()),
                data_transfer_text: None,
                facts: InsertTextFacts {
                    target_range_mismatch: true,
                    ..Default::default()
                },
                last_key: Some(Arc::from("x")),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(&*core.state().root_text_content(), "abcx");
    assert!(output.effects.contains(&Effect::PreventDefault));
}
#[test]
fn empty_android_composition_is_scheduled_and_token_edits_are_rejected() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .view_host(ViewHost {
            engine: ViewEngine::Chromium,
            os: ViewOs::Android,
        })
        .build()
        .unwrap();
    let ((text, token), _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            let token = tx.create(Tab::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key(), token.key()])?;
            Ok((t.key(), token.key()))
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .apply(
            Input::TextFromView {
                key: text,
                text: "".into(),
                anchor: None,
                focus: None,
                composition_end: true,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(0),
        )
        .unwrap();
    assert!(output.effects.contains(&Effect::ScheduleRemoveEmptyText {
        key: text,
        delay_ms: 20
    }));
    assert_eq!(core.state().view().text_content(text), "abc");
    let error = core
        .apply(
            Input::TextFromView {
                key: token,
                text: "not a tab".into(),
                anchor: None,
                focus: None,
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "TabSetTextContent");
    assert_eq!(core.state().view().text_content(token), "\t");
    assert!(!core.state().can_remove_text(token, token));
}

#[test]
fn transformed_browser_text_reconciles_instead_of_eliding_a_mismatch() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .transform::<Text>(|tx, key| {
            let text = tx.text_content(key).to_uppercase();
            if tx.text_content(key) != text {
                tx.text(key)?.set_text_content(&text)?;
            }
            Ok(())
        })
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("A")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(t, Utf16Offset(1)),
            ))))?;
            Ok(t.key())
        })
        .unwrap();
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
            Input::TextFromView {
                key: text,
                text: "Ab".into(),
                anchor: Some(Utf16Offset(2)),
                focus: Some(Utf16Offset(2)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(2)),
                    focus: Point::text(text, Utf16Offset(2)),
                    resolution_dirty: false,
                },
            },
            HistoryTime(0),
        )
        .unwrap();
    assert_eq!(output.diff.view_text_matches, None);
    assert_eq!(
        output.diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "AB".into()
        }]
    );
    assert!(
        output
            .effects
            .iter()
            .any(|effect| matches!(effect, Effect::SetViewSelection { .. }))
    );
}

#[test]
fn android_composition_clear_keeps_text_and_restores_anchor_typing_style() {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("漢字")?;
            tx.text(t)?
                .set_format(TextFormat::BOLD)?
                .set_style("color: red")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(t, Utf16Offset(2)),
            ))))?;
            tx.set_composition_key(Some(t.key()))?;
            Ok(t.key())
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    for time in [1, 31] {
        core.apply(
            Input::Composition {
                event: CompositionEvent::Clear,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(time),
        )
        .unwrap();
        assert_eq!(core.composition(), Composition::Idle);
        assert_eq!(core.state().view().text_content(key), "漢字");
        let range = core
            .state()
            .selection()
            .and_then(Selection::as_range)
            .unwrap();
        assert_eq!(range.format, TextFormat::BOLD);
        assert_eq!(range.style.as_ref(), "color: red");
    }
}
