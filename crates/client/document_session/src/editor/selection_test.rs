use super::*;

#[test]
fn restored_headless_caret_retains_typing_attributes_and_rejects_view_input() {
    let mut surface = EditorSurface::new(
        EditorConfig {
            mode: EditorMode::Headless,
            builder: Arc::new(|mode, peer| {
                default_editor_builder(mode, peer).initial_state(
                    serde_json::from_value(
                        serde_json::json!({"root":{"type":"root","version":1,"children":[{
                            "type":"paragraph","version":1,"children":[{
                                "type":"text","version":1,"text":"abcdef","format":1,
                                "detail":0,"mode":"normal","style":"color: red;"
                            }]
                        }]}}),
                    )
                    .unwrap(),
                )
            }),
            ..EditorConfig::default()
        },
        17,
        Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        },
    )
    .unwrap();
    let text = surface
        .core
        .state()
        .view()
        .descendants(NodeKey::ROOT)
        .find_map(|(key, _)| surface.core.state().view().is_text(key).then_some(key))
        .unwrap();
    let restore = |offset| Input::Command {
        command: Command::Extension(ExtensionCommand::new(
            &builder::RESTORE_MODEL_SELECTION,
            Some(RangeSelection::new(
                Point::text(text, Utf16Offset(offset)),
                Point::text(text, Utf16Offset(offset)),
            )),
        )),
        selection: ViewSelection::KeepModel,
    };
    surface.core.apply(restore(2), HistoryTime(0)).unwrap();
    surface
        .core
        .apply(
            Input::Command {
                command: Command::FormatText(TextFormatType::Italic),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    surface.core.apply(restore(4), HistoryTime(2)).unwrap();
    let before = surface.core.state().to_json().unwrap();
    let error = surface
        .core
        .apply(
            Input::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(0)),
                    focus: Point::text(text, Utf16Offset(0)),
                    resolution_dirty: false,
                },
                change: None,
            },
            HistoryTime(3),
        )
        .unwrap_err();
    assert!(matches!(error.error, Error::ViewSelectionInHeadless));
    assert_eq!(surface.core.state().to_json().unwrap(), before);
    surface
        .core
        .apply(
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(4),
        )
        .unwrap();
    let state = surface.core.state().to_json().unwrap();
    let nodes = state.root["children"][0]["children"].as_array().unwrap();
    assert_eq!(
        nodes
            .iter()
            .filter_map(|node| node["text"].as_str())
            .collect::<String>(),
        "abcdxef"
    );
    let inserted = nodes
        .iter()
        .find(|node| node["text"] == "x")
        .expect("separate styled insertion");
    assert_eq!(inserted["format"], serde_json::json!(3));
    assert_eq!(inserted["style"], serde_json::json!("color: red;"));
}

#[test]
fn composition_newline_redo_restores_the_committed_element_caret() {
    for changed in [false, true] {
        let now = Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        };
        let mut surface = EditorSurface::new(
            EditorConfig {
                builder: Arc::new(|_, _| {
                    let builder = macro_document_model::preset_builder(
                        macro_document_model::EditorType::MarkdownSync,
                    );
                    let builder = register_editor_commands(builder).plugin(NewlineKey);
                    macro_document_model::node_ids::NodeIdPlugin::register(
                        builder,
                        &["root", "paragraph", "text", "linebreak"],
                        None,
                        [7; 32],
                    )
                }),
                policy: &macro_document_model::sync::MACRO_SYNC_POLICY,
                view_host: ViewHost {
                    engine: ViewEngine::Native,
                    os: ViewOs::Android,
                },
                ..EditorConfig::default()
            },
            7,
            now,
        )
        .unwrap();
        let doc = lexical_loro::new_doc(7).unwrap();
        let mut view = vec![];
        surface.init(&doc, now, Access::Edit, &mut view).unwrap();
        let state = serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children": if changed { vec![serde_json::json!({"type":"text","text":"か"})] } else { vec![] }}]}})).unwrap();
        surface
            .apply(
                &doc,
                Input::SetState {
                    state,
                    tags: TagSet::default(),
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        let state = surface.state();
        let paragraph = state.view().children(NodeKey::ROOT).next().unwrap();
        let point = if changed {
            Point::text(
                state.view().children(paragraph).next().unwrap(),
                Utf16Offset(1),
            )
        } else {
            Point::element(paragraph, ChildIndex(0))
        };
        surface
            .apply(
                &doc,
                Input::SelectionFromView {
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                    change: None,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::ClearHistory,
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        surface
            .apply(
                &doc,
                Input::Composition {
                    event: CompositionEvent::Start { data: "".into() },
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        if changed {
            let key = surface
                .state()
                .selection()
                .unwrap()
                .as_range()
                .unwrap()
                .anchor
                .key();
            surface
                .apply(
                    &doc,
                    Input::TextFromView {
                        key,
                        text: "漢".into(),
                        anchor: Some(Utf16Offset(1)),
                        focus: Some(Utf16Offset(1)),
                        composition_end: false,
                        composition_data: None,
                        selection: ViewSelection::KeepModel,
                    },
                    now,
                    Access::Edit,
                    &mut view,
                )
                .unwrap();
        }
        let key = surface
            .state()
            .selection()
            .unwrap()
            .as_range()
            .unwrap()
            .anchor
            .key();
        surface
            .apply(
                &doc,
                Input::Composition {
                    event: CompositionEvent::End {
                        key,
                        text: if changed { "漢".into() } else { "".into() },
                        anchor: Some(Utf16Offset(u32::from(changed))),
                        focus: Some(Utf16Offset(u32::from(changed))),
                        data: if changed { "漢\n".into() } else { "\n".into() },
                    },
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        let after = surface.state().to_json().unwrap();
        let expected = surface.selection_cursors().unwrap();
        surface
            .apply(&doc, Input::Undo, now, Access::Edit, &mut view)
            .unwrap();
        surface
            .apply(&doc, Input::Redo, now, Access::Edit, &mut view)
            .unwrap();
        assert_eq!(surface.state().to_json().unwrap(), after);
        let actual = surface.selection_cursors().unwrap();
        assert_eq!(
            actual.anchor.node_id, expected.anchor.node_id,
            "changed={changed}"
        );
        assert_eq!(
            actual.focus.node_id, expected.focus.node_id,
            "changed={changed}"
        );
        let selection = surface.state().selection().unwrap().as_range().unwrap();
        assert_eq!(selection.anchor.offset(), 0);
        assert_eq!(selection.focus.offset(), 0);
    }
}

// The application owns key routing; this branch's registry predates its keyboard
// plugin. Deliver Enter to the same registered paragraph command, without
// substituting model state, history or selection behavior.
struct NewlineKey;
impl Plugin for NewlineKey {
    fn name(&self) -> &'static str {
        "test-newline-key"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::Key(KeyCommand::Enter),
            priority: CommandPriority::Editor,
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
            tx.dispatch(&Command::InsertParagraph)?;
            Ok(Handled::Yes)
        } else {
            Ok(Handled::No)
        }
    }
}

#[test]
fn history_cursors_follow_remote_text_and_repeated_headless_and_focused_redo() {
    for mode in [EditorMode::Headless, EditorMode::ViewAttached] {
        for focused in [false, true] {
            let now = Now {
                mono: doc_sync_core::Millis(0),
                wall: doc_sync_core::UnixMillis(0),
            };
            let source = default_editor_builder(EditorMode::Headless, 7).initial_state(serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"ab😀cd"}]}]}})).unwrap()).build().unwrap();
            let doc = lexical_loro::new_doc(7).unwrap();
            LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
            let mut surface = EditorSurface::new(
                EditorConfig {
                    mode,
                    ..EditorConfig::default()
                },
                7,
                now,
            )
            .unwrap();
            let mut view = vec![];
            surface.init(&doc, now, Access::Edit, &mut view).unwrap();
            surface.focused = focused;
            surface.focus_known = true;
            let text = surface
                .state()
                .view()
                .all_text_nodes(NodeKey::ROOT)
                .next()
                .unwrap();
            let point = Point::text(text, Utf16Offset(1));
            let select = if mode == EditorMode::Headless {
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(
                        &builder::RESTORE_MODEL_SELECTION,
                        Some(RangeSelection::new(point, point)),
                    )),
                    selection: ViewSelection::KeepModel,
                }
            } else {
                Input::SelectionFromView {
                    selection: ViewSelection::Range {
                        anchor: point,
                        focus: point,
                        resolution_dirty: false,
                    },
                    change: None,
                }
            };
            surface
                .apply(&doc, select, now, Access::Edit, &mut view)
                .unwrap();
            surface
                .apply(
                    &doc,
                    Input::Command {
                        command: Command::InsertText("x".into()),
                        selection: ViewSelection::KeepModel,
                    },
                    now,
                    Access::Edit,
                    &mut view,
                )
                .unwrap();
            let cursor = surface.selection_cursors().unwrap().anchor;
            let remote = lexical_loro::fork_doc(&doc, 60).unwrap();
            let loro::Container::Text(remote_text) =
                remote.get_container(cursor.cursor.container).unwrap()
            else {
                panic!("text");
            };
            remote_text.insert(0, "é").unwrap();
            remote.commit();
            doc.import(
                &remote
                    .export(loro::ExportMode::updates(&doc.oplog_vv()))
                    .unwrap(),
            )
            .unwrap();
            surface
                .remote_pending(&doc, now, Access::Edit, &mut view, false)
                .unwrap();
            assert_eq!(
                surface
                    .state()
                    .selection()
                    .unwrap()
                    .as_range()
                    .unwrap()
                    .anchor
                    .offset(),
                3
            );
            for _ in 0..3 {
                surface
                    .apply(&doc, Input::Undo, now, Access::Edit, &mut view)
                    .unwrap();
                assert_eq!(surface.state().root_text_content().as_ref(), "éab😀cd");
                assert_eq!(
                    surface
                        .state()
                        .selection()
                        .unwrap()
                        .as_range()
                        .unwrap()
                        .anchor
                        .offset(),
                    2
                );
                surface
                    .apply(&doc, Input::Redo, now, Access::Edit, &mut view)
                    .unwrap();
                assert_eq!(surface.state().root_text_content().as_ref(), "éaxb😀cd");
                assert_eq!(
                    surface
                        .state()
                        .selection()
                        .unwrap()
                        .as_range()
                        .unwrap()
                        .anchor
                        .offset(),
                    3
                );
            }
        }
    }
}

#[test]
fn explicit_none_and_failed_history_do_not_restore_stale_cursors() {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let source = default_editor_builder(EditorMode::Headless, 7).initial_state(serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"ab"}]}]}})).unwrap()).build().unwrap();
    let doc = lexical_loro::new_doc(7).unwrap();
    LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
    let mut surface = EditorSurface::new(EditorConfig::default(), 7, now).unwrap();
    let mut view = vec![];
    surface.init(&doc, now, Access::Edit, &mut view).unwrap();
    let text = surface
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .unwrap();
    surface
        .apply(
            &doc,
            Input::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(1)),
                    focus: Point::text(text, Utf16Offset(1)),
                    resolution_dirty: false,
                },
                change: None,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    surface
        .apply(
            &doc,
            Input::TextFromView {
                key: text,
                text: "abc".into(),
                anchor: None,
                focus: None,
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::None,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    surface
        .apply(&doc, Input::Undo, now, Access::Edit, &mut view)
        .unwrap();
    assert_eq!(surface.state().root_text_content().as_ref(), "ab");
    assert!(surface.state().selection().is_none());
    surface
        .apply(&doc, Input::Redo, now, Access::Edit, &mut view)
        .unwrap();
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(1)),
                    focus: Point::text(text, Utf16Offset(1)),
                    resolution_dirty: false,
                },
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    surface.fail_next_remote = true;
    assert!(
        surface
            .apply(&doc, Input::Undo, now, Access::Edit, &mut view)
            .is_err()
    );
    assert!(surface.history_selection.take_popped().is_none());
    surface
        .apply(
            &doc,
            Input::SelectionFromView {
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(2)),
                    focus: Point::text(text, Utf16Offset(2)),
                    resolution_dirty: false,
                },
                change: None,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    surface
        .remote_pending(&doc, now, Access::Edit, &mut view, false)
        .unwrap();
    assert_eq!(
        surface
            .state()
            .selection()
            .unwrap()
            .as_range()
            .unwrap()
            .anchor
            .offset(),
        2
    );
}

#[test]
fn inline_boundary_selection_records_the_models_resolved_endpoint() {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let source = default_editor_builder(EditorMode::Headless, 7).initial_state(serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a","format":1},{"type":"text","text":"b","format":2}]}]}})).unwrap()).build().unwrap();
    let doc = lexical_loro::new_doc(7).unwrap();
    LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
    let mut surface = EditorSurface::new(EditorConfig::default(), 7, now).unwrap();
    let mut view = vec![];
    surface.init(&doc, now, Access::Edit, &mut view).unwrap();
    let texts = surface
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .collect::<Vec<_>>();
    assert_eq!(texts.len(), 2);
    let point = Point::text(texts[1], Utf16Offset(0));
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::Range {
                    anchor: point,
                    focus: point,
                    resolution_dirty: false,
                },
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    surface
        .apply(&doc, Input::Undo, now, Access::Edit, &mut view)
        .unwrap();
    let selection = surface.state().selection().unwrap().as_range().unwrap();
    assert_eq!(selection.anchor, Point::text(texts[0], Utf16Offset(1)));
    assert_eq!(selection.focus, selection.anchor);
}
