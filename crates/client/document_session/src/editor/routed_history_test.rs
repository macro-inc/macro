use super::*;

struct ConsumeHistoryKey(CommandKind);
impl Plugin for ConsumeHistoryKey {
    fn name(&self) -> &'static str {
        "consume-history-key"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const KEY: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::KeyDown,
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }];
        const UNDO: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::Undo,
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }];
        if self.0 == CommandKind::KeyDown {
            KEY
        } else {
            UNDO
        }
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::Yes)
    }
}

#[test]
fn routed_history_uses_loro_after_key_and_command_listeners() {
    for engine in [ViewEngine::Chromium, ViewEngine::Native] {
        for consume in [None, Some(CommandKind::KeyDown), Some(CommandKind::Undo)] {
            let now = Now {
                mono: doc_sync_core::Millis(0),
                wall: doc_sync_core::UnixMillis(0),
            };
            let source = default_editor_builder(EditorMode::Headless, 7)
                .initial_state(serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"code"}]}]}})).unwrap())
                .build().unwrap();
            let doc = lexical_loro::new_doc(7).unwrap();
            LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
            let mut surface = EditorSurface::new(
                EditorConfig {
                    builder: Arc::new(move |mode, peer| {
                        let builder = default_editor_builder(mode, peer);
                        if let Some(kind) = consume {
                            builder.plugin(ConsumeHistoryKey(kind))
                        } else {
                            builder
                        }
                    }),
                    view_host: ViewHost {
                        engine,
                        os: ViewOs::Other,
                    },
                    ..EditorConfig::default()
                },
                7,
                now,
            )
            .unwrap();
            let mut view = vec![];
            surface.init(&doc, now, Access::Edit, &mut view).unwrap();
            surface.focused = true;
            surface.focus_known = true;
            let text = surface
                .state()
                .view()
                .all_text_nodes(NodeKey::ROOT)
                .next()
                .unwrap();
            let before = Point::text(text, Utf16Offset(4));
            surface
                .apply(
                    &doc,
                    Input::Command {
                        command: Command::InsertText("😀".into()),
                        selection: ViewSelection::Range {
                            anchor: before,
                            focus: before,
                            resolution_dirty: false,
                        },
                    },
                    now,
                    Access::Edit,
                    &mut view,
                )
                .unwrap();
            let committed = surface.state().to_json().unwrap();
            let selection = surface.state().selection().cloned();
            let vv = doc.oplog_vv();
            assert_eq!(&*surface.state().root_text_content(), "code😀");
            view.clear();
            let changed = surface
                .apply(
                    &doc,
                    Input::KeyDown {
                        event: KeyEvent {
                            key: "z".into(),
                            ctrl: true,
                            ..KeyEvent::default()
                        },
                        routed: Some(Command::Undo),
                        routed_prevent_default: true,
                        selection: ViewSelection::KeepModel,
                    },
                    now,
                    Access::Edit,
                    &mut view,
                )
                .unwrap();
            assert_eq!(surface.command_handled(), Handled::Yes);
            if consume.is_some() {
                assert!(!changed);
                assert_eq!(surface.state().to_json().unwrap(), committed);
                assert_eq!(surface.state().selection(), selection.as_ref());
                assert_eq!(doc.oplog_vv(), vv);
                assert_eq!(surface.undo.as_ref().unwrap().undo_count(), 1);
                assert_eq!(
                    view.iter()
                        .any(|effect| matches!(effect, ViewEffect::Editor(Effect::PreventDefault))),
                    consume == Some(CommandKind::Undo)
                );
                continue;
            }
            assert!(changed);
            assert_eq!(&*surface.state().root_text_content(), "code");
            assert_eq!(
                surface
                    .state()
                    .selection()
                    .unwrap()
                    .as_range()
                    .unwrap()
                    .anchor,
                before
            );
            assert!(
                view.iter()
                    .any(|effect| matches!(effect, ViewEffect::Editor(Effect::PreventDefault)))
            );
            assert!(
                view.iter()
                    .any(|effect| matches!(effect, ViewEffect::Diff(_)))
            );
            for (key, shift) in [("Z", true), ("y", false)] {
                surface
                    .apply(
                        &doc,
                        Input::KeyDown {
                            event: KeyEvent {
                                key: key.into(),
                                ctrl: true,
                                shift,
                                ..KeyEvent::default()
                            },
                            routed: Some(Command::Redo),
                            routed_prevent_default: true,
                            selection: ViewSelection::KeepModel,
                        },
                        now,
                        Access::Edit,
                        &mut view,
                    )
                    .unwrap();
                assert_eq!(surface.state().to_json().unwrap(), committed);
                assert_eq!(surface.state().selection(), selection.as_ref());
                if shift {
                    surface
                        .apply(
                            &doc,
                            Input::KeyDown {
                                event: KeyEvent {
                                    key: "z".into(),
                                    ctrl: true,
                                    ..KeyEvent::default()
                                },
                                routed: Some(Command::Undo),
                                routed_prevent_default: false,
                                selection: ViewSelection::KeepModel,
                            },
                            now,
                            Access::Edit,
                            &mut view,
                        )
                        .unwrap();
                }
            }
        }
    }
}

struct EditBeforeHistory(bool);
impl Plugin for EditBeforeHistory {
    fn name(&self) -> &'static str {
        "edit-before-history"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::KeyDown,
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        tx.insert_text("!")?;
        if self.0 {
            return Err(Error::Invariant("keydown failed"));
        }
        Ok(Handled::No)
    }
}

#[test]
fn routed_history_projects_listener_commits_before_fallback_and_never_runs_on_error() {
    for fail in [false, true] {
        let now = Now {
            mono: doc_sync_core::Millis(0),
            wall: doc_sync_core::UnixMillis(0),
        };
        let source = default_editor_builder(EditorMode::Headless, 7)
            .initial_state(serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"code"}]}]}})).unwrap())
            .build().unwrap();
        let doc = lexical_loro::new_doc(7).unwrap();
        LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
        let mut surface = EditorSurface::new(
            EditorConfig {
                builder: Arc::new(move |mode, peer| {
                    default_editor_builder(mode, peer).plugin(EditBeforeHistory(fail))
                }),
                ..EditorConfig::default()
            },
            7,
            now,
        )
        .unwrap();
        let mut view = vec![];
        surface.init(&doc, now, Access::Edit, &mut view).unwrap();
        surface.focused = true;
        surface.focus_known = true;
        let text = surface
            .state()
            .view()
            .all_text_nodes(NodeKey::ROOT)
            .next()
            .unwrap();
        let point = Point::text(text, Utf16Offset(4));
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("😀".into()),
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
        let before = surface.state().to_json().unwrap();
        let vv = doc.oplog_vv();
        view.clear();
        let changed = surface
            .apply(
                &doc,
                Input::KeyDown {
                    event: KeyEvent {
                        key: "z".into(),
                        ctrl: true,
                        ..KeyEvent::default()
                    },
                    routed: Some(Command::Undo),
                    routed_prevent_default: true,
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        if fail {
            assert!(!changed);
            assert_eq!(surface.state().to_json().unwrap(), before);
            assert_eq!(doc.oplog_vv(), vv);
            assert_eq!(surface.undo.as_ref().unwrap().undo_count(), 1);
            assert_eq!(surface.undo.as_ref().unwrap().redo_count(), 0);
            assert!(view.iter().any(|effect| matches!(
                effect,
                ViewEffect::Error(SessionError::Model(Error::Invariant("keydown failed")))
            )));
        } else {
            assert!(changed);
            assert_eq!(&*surface.state().root_text_content(), "code");
            let texts = view
                .iter()
                .filter_map(|effect| match effect {
                    ViewEffect::Diff(diff) => Some(diff.ops.iter().filter_map(|op| match op {
                        DiffOp::Text { text, .. } => Some(text.as_str()),
                        _ => None,
                    })),
                    _ => None,
                })
                .flatten()
                .collect::<Vec<_>>();
            assert_eq!(texts, ["code😀!", "code"]);
            assert_eq!(surface.undo.as_ref().unwrap().undo_count(), 0);
            assert_eq!(surface.undo.as_ref().unwrap().redo_count(), 1);
            surface
                .apply(&doc, Input::Redo, now, Access::Edit, &mut view)
                .unwrap();
            assert_eq!(&*surface.state().root_text_content(), "code😀!");
        }
    }
}
