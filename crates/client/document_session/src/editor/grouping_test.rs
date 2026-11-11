use super::*;
use serde_json::json;
use std::sync::atomic::AtomicI64;

fn now(time: u64) -> Now {
    Now {
        mono: doc_sync_core::Millis(time),
        wall: doc_sync_core::UnixMillis(i64::try_from(time).expect("test time")),
    }
}

#[test]
fn table_resize_within_delay_undo_removes_table_and_redo_keeps_all_moves() {
    let config = crate::application::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let mut surface = EditorSurface::new(config, 7, now(0)).expect("actual Macro session surface");
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    let mut view = Vec::new();
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("initialize");
    surface.apply(&doc, Input::SetState {
        state: serde_json::from_value(json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"base"}]}]}})).expect("initial model"),
        tags: TagSet::default(),
    }, now(0), Access::Edit, &mut view).expect("base model");
    let text = surface
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("base text");
    let point = Point::text(text, Utf16Offset(4));
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
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("base caret");
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::ClearHistory,
                selection: ViewSelection::KeepModel,
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("clear bootstrap history");
    let before_insert = surface.state().to_json().expect("before table insertion");
    let command = macro_document_model::surface::decode_command(
        "group-b.table",
        &json!({"action":"insert","rows":1,"columns":2,"headers":false}).to_string(),
        text.generation(),
        None,
    )
    .expect("decode table insertion")
    .expect("registered table insertion");
    surface
        .apply(
            &doc,
            Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("insert table");
    let table = surface
        .state()
        .view()
        .children(NodeKey::ROOT)
        .find(|key| surface.state().view().type_name(*key).ok() == Some("table"))
        .expect("actual inserted table");
    let before = surface.state().to_json().expect("before resize");
    for (time, delta, merge) in [(100, 20.0, false), (200, 50.0, true)] {
        let command = macro_document_model::surface::decode_command(
            "group-b.table", &json!({"action":"resize-column","table":table.index(),"column":0,"baseWidths":[160,160],"delta":delta,"merge":merge}).to_string(),
            table.generation(), None,
        ).expect("decode actual resize").expect("registered resize");
        surface
            .apply(
                &doc,
                Input::Command {
                    command,
                    selection: ViewSelection::KeepModel,
                },
                now(time),
                Access::Edit,
                &mut view,
            )
            .expect("resize within 400ms");
    }
    let after = surface.state().to_json().expect("after resize");
    assert_ne!(before, after);
    surface
        .apply(&doc, Input::Undo, now(300), Access::Edit, &mut view)
        .expect("undo resize");
    assert!(!surface.state().view().is_attached(table));
    assert_eq!(surface.state().to_json().expect("undo JSON"), before_insert);
    surface
        .apply(&doc, Input::Redo, now(300), Access::Edit, &mut view)
        .expect("redo resize");
    assert_eq!(surface.state().to_json().expect("redo JSON"), after);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operation {
    Typing,
    Paste,
    Format,
    NodeInsert,
    ExplicitPush,
}
static OPERATION: CommandKey<Operation> = CommandKey::new("history-boundary-control");
struct BoundaryControl;
impl Plugin for BoundaryControl {
    fn name(&self) -> &'static str {
        "history-boundary-control"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&OPERATION),
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(operation) = command.payload(&OPERATION) else {
            return Ok(Handled::No);
        };
        match operation {
            Operation::Typing | Operation::ExplicitPush | Operation::Paste => {
                if *operation == Operation::ExplicitPush {
                    tx.add_tag(UpdateTag::HistoryPush);
                }
                return tx.dispatch(&Command::InsertText(
                    if *operation == Operation::Paste {
                        "pasted"
                    } else {
                        "c"
                    }
                    .into(),
                ));
            }
            Operation::Format => {
                let text = tx
                    .view()
                    .all_text_nodes(NodeKey::ROOT)
                    .next()
                    .expect("actual text");
                tx.text(text)?.set_format(TextFormat::BOLD)?;
            }
            Operation::NodeInsert => {
                let paragraph = tx.create(Paragraph::default())?;
                let text = tx.create_text("new")?;
                tx.append(paragraph, &[text.key()])?;
                tx.append(NodeKey::ROOT, &[paragraph.key()])?;
                tx.select_end(paragraph)?;
            }
        }
        Ok(Handled::Yes)
    }
}

#[test]
fn collaborative_interval_merges_typing_paste_format_node_and_explicit_push() {
    for operation in [
        Operation::Typing,
        Operation::Paste,
        Operation::Format,
        Operation::NodeInsert,
        Operation::ExplicitPush,
    ] {
        let config = EditorConfig {
            builder: Arc::new(|mode, peer| {
                default_editor_builder(mode, peer).plugin(BoundaryControl)
            }),
            ..EditorConfig::default()
        };
        let mut surface = EditorSurface::new(config, 7, now(0)).expect("actual session");
        let doc = lexical_loro::new_doc(7).expect("actual Loro");
        let mut view = Vec::new();
        surface
            .init(&doc, now(0), Access::Edit, &mut view)
            .expect("init");
        surface.apply(&doc, Input::SetState {
            state: serde_json::from_value(json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"a"}]}]}})).expect("base"),
            tags: TagSet::default(),
        }, now(0), Access::Edit, &mut view).expect("set base");
        let text = surface
            .state()
            .view()
            .all_text_nodes(NodeKey::ROOT)
            .next()
            .expect("base text");
        let point = Point::text(text, Utf16Offset(1));
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
                now(0),
                Access::Edit,
                &mut view,
            )
            .expect("base caret");
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::ClearHistory,
                    selection: ViewSelection::KeepModel,
                },
                now(0),
                Access::Edit,
                &mut view,
            )
            .expect("clear history");
        let base = surface.state().to_json().expect("base JSON");
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("b".into()),
                    selection: ViewSelection::KeepModel,
                },
                now(100),
                Access::Edit,
                &mut view,
            )
            .expect("first key");
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(&OPERATION, operation)),
                    selection: ViewSelection::KeepModel,
                },
                now(200),
                Access::Edit,
                &mut view,
            )
            .expect("second update");
        let after = surface.state().to_json().expect("after JSON");
        surface
            .apply(&doc, Input::Undo, now(300), Access::Edit, &mut view)
            .expect("undo");
        assert_eq!(
            surface.state().to_json().expect("undo JSON"),
            base,
            "{operation:?}"
        );
        surface
            .apply(&doc, Input::Redo, now(300), Access::Edit, &mut view)
            .expect("redo");
        assert_eq!(
            surface.state().to_json().expect("redo JSON"),
            after,
            "{operation:?}"
        );
    }
}

fn typed_code_shortcut(engine: ViewEngine) -> (EditorSurface, LoroDoc, Vec<ViewEffect>) {
    let config = crate::application::application_editor_config(
        EditorConfig {
            view_host: ViewHost {
                engine,
                os: ViewOs::Other,
            },
            ..EditorConfig::default()
        },
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let mut surface = EditorSurface::new(config.clone(), 7, now(0)).expect("actual Macro surface");
    let doc = lexical_loro::new_doc(7).expect("actual Loro document");
    let mut view = Vec::new();
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("fresh document");
    surface
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(
                    json!({"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}),
                )
                .expect("new document paragraph"),
                tags: TagSet::default(),
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("persist the new document before reload");
    let mut surface = EditorSurface::new(config, 7, now(0)).expect("reloaded Macro surface");
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("reload persisted fresh document");
    surface.focused = true;
    surface.focus_known = true;
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("initial paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
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
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("body click selection");
    for time in 1..=3 {
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("`".into()),
                    selection: ViewSelection::KeepModel,
                },
                now(time),
                Access::Edit,
                &mut view,
            )
            .expect("type code fence");
    }
    surface
        .apply(
            &doc,
            Input::KeyDown {
                event: KeyEvent {
                    key: "Enter".into(),
                    ..KeyEvent::default()
                },
                routed: Some(Command::Key {
                    command: KeyCommand::Enter,
                    event: Some(KeyEvent {
                        key: "Enter".into(),
                        ..KeyEvent::default()
                    }),
                }),
                routed_prevent_default: true,
                selection: ViewSelection::KeepModel,
            },
            now(4),
            Access::Edit,
            &mut view,
        )
        .expect("Enter code shortcut");
    for (index, character) in "const installCheck = \"durable\";".chars().enumerate() {
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText(character.to_string()),
                    selection: ViewSelection::KeepModel,
                },
                now(5 + u64::try_from(index).expect("character index")),
                Access::Edit,
                &mut view,
            )
            .expect("type code character");
    }
    let code = surface
        .state()
        .view()
        .children(NodeKey::ROOT)
        .find(|key| surface.state().view().type_name(*key).ok() == Some("custom-code"))
        .expect("actual code shortcut block");
    assert_eq!(
        surface.state().view().text_content(code),
        "const installCheck = \"durable\";"
    );
    (surface, doc, view)
}

#[test]
fn markdown_code_shortcut_typing_undo_removes_the_whole_code_block() {
    let (mut surface, doc, mut view) = typed_code_shortcut(ViewEngine::Native);
    // Actual full-app Source: first Ctrl+Z leaves no code and empty body;
    // a second Ctrl+Z also leaves no code and empty body.
    for time in [100, 101] {
        surface
            .apply(&doc, Input::Undo, now(time), Access::Edit, &mut view)
            .expect("Ctrl+Z");
        assert!(
            !surface
                .state()
                .view()
                .children(NodeKey::ROOT)
                .any(|key| surface.state().view().type_name(key).ok() == Some("custom-code")),
            "code retained after undo: {:?}",
            surface.state().to_json()
        );
        assert!(surface.state().root_text_content().is_empty());
    }
}

#[test]
fn browser_code_history_waits_for_an_actual_selection_after_the_cursor_disappears() {
    for feedback in [false, true] {
        let (mut surface, doc, mut view) = typed_code_shortcut(ViewEngine::Chromium);
        for (input, expected, time) in [
            (Input::Undo, "", 100),
            (Input::Redo, "const installCheck = \"durable\";\n\n", 101),
        ] {
            view.clear();
            assert!(
                surface
                    .apply(&doc, input, now(time), Access::Edit, &mut view)
                    .expect("actual history")
            );
            assert_eq!(surface.state().root_text_content().as_ref(), expected);
            assert_eq!(surface.state().selection(), None);
            assert!(view.iter().any(|effect| matches!(effect,
                ViewEffect::CommitTags(tags) if tags.iter().any(|tag| tag == "skip-dom-selection")
            )));
            assert!(view.iter().any(|effect| matches!(
                effect,
                ViewEffect::Editor(Effect::SetViewSelection {
                    selection: ViewSelection::None,
                    ..
                })
            )));
            assert!(
                !view
                    .iter()
                    .any(|effect| matches!(effect, ViewEffect::HistoryAwarenessSelection { .. }))
            );
            if feedback && time == 100 {
                let paragraph = surface
                    .state()
                    .view()
                    .first_child(NodeKey::ROOT)
                    .expect("surviving paragraph");
                let point = Point::element(paragraph, lexical_model::ChildIndex(0));
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
                        now(100),
                        Access::Edit,
                        &mut view,
                    )
                    .expect("admit actual browser paragraph feedback");
                assert!(surface.state().selection().is_some());
            }
        }
    }
}

#[test]
fn browser_history_restores_surviving_awareness_without_stealing_focus() {
    for focused in [true, false] {
        let config = crate::application::application_editor_config(
            EditorConfig {
                view_host: ViewHost {
                    engine: ViewEngine::Chromium,
                    os: ViewOs::Other,
                },
                ..EditorConfig::default()
            },
            Arc::new(AtomicI64::new(0)),
            macro_document_model::EditorType::MarkdownSync,
        );
        let mut surface = EditorSurface::new(config, 7, now(0)).expect("actual Macro surface");
        let doc = lexical_loro::new_doc(7).expect("actual Loro");
        let mut view = Vec::new();
        surface
            .init(&doc, now(0), Access::Edit, &mut view)
            .expect("open");
        surface
            .apply(
                &doc,
                Input::SetState {
                    state: serde_json::from_value(json!({"root":{"type":"root","children":[
                        {"type":"paragraph","children":[{"type":"text","text":"abc"}]}
                    ]}}))
                    .expect("initial model"),
                    tags: TagSet::default(),
                },
                now(0),
                Access::Edit,
                &mut view,
            )
            .expect("persist initial text");
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::ClearHistory,
                    selection: ViewSelection::KeepModel,
                },
                now(0),
                Access::Edit,
                &mut view,
            )
            .expect("clear bootstrap history");
        let text = surface
            .state()
            .view()
            .all_text_nodes(NodeKey::ROOT)
            .next()
            .expect("text");
        let at = |offset| {
            let point = Point::text(text, Utf16Offset(offset));
            ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            }
        };
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("X".into()),
                    selection: at(2),
                },
                now(500),
                Access::Edit,
                &mut view,
            )
            .expect("type inside surviving text");
        let live = surface
            .state()
            .selection()
            .expect("live selection after typing");
        let expected = surface
            .projection
            .as_ref()
            .expect("attached projection")
            .cursor(&doc, surface.state(), live);
        assert!(expected.is_some());
        assert_eq!(surface.selection_cursors(), expected);
        surface.focus_known = true;
        surface.focused = focused;
        for (input, expected, offset, time) in [
            (Input::Undo, "abc", 2, 600),
            (Input::Redo, "abXc", if focused { 3 } else { 0 }, 700),
        ] {
            view.clear();
            assert!(
                surface
                    .apply(&doc, input, now(time), Access::Edit, &mut view)
                    .expect("actual history")
            );
            assert_eq!(surface.state().root_text_content().as_ref(), expected);
            assert_eq!(view_selection(surface.state().selection()), at(offset));
            let main = view
                .iter()
                .position(|effect| {
                    matches!(
                        effect,
                        ViewEffect::Editor(Effect::SetViewSelection {
                            selection: ViewSelection::None,
                            ..
                        })
                    )
                })
                .expect("clear selection in main output");
            let restored = view
                .iter()
                .position(|effect| {
                    matches!(effect,
                        ViewEffect::HistoryAwarenessSelection {selection, write_dom, ..}
                            if selection == &at(offset) && *write_dom == focused
                    )
                })
                .expect("actual live-awareness presentation");
            assert!(main < restored);
            assert!(view[main+1..restored].iter().any(|effect| matches!(effect,
                ViewEffect::CommitTags(tags) if tags.iter().any(|tag| tag == "collab-selection")
                    && tags.iter().any(|tag| tag == "skip-dom-selection") != focused
            )));
            if !focused {
                surface
                    .apply(
                        &doc,
                        Input::SelectionFromView {
                            selection: at(0),
                            change: None,
                        },
                        now(time + 1),
                        Access::Edit,
                        &mut view,
                    )
                    .expect("accept actual browser's text-zero boundary");
            }
        }
    }
}

fn fresh_application_history() -> (EditorSurface, LoroDoc, Vec<ViewEffect>) {
    let config = crate::application::application_editor_config(
        EditorConfig::default(),
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let doc = lexical_loro::new_doc(7).expect("actual Loro document");
    let mut view = Vec::new();
    let mut writer = EditorSurface::new(config.clone(), 7, now(0)).expect("new document writer");
    writer
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("initialize new document");
    writer
        .apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(
                    json!({"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}}),
                )
                .expect("new document paragraph"),
                tags: TagSet::default(),
            },
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("persist fresh document");
    drop(writer);
    let mut surface = EditorSurface::new(config, 7, now(0)).expect("reloaded application surface");
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("reload actual persisted document");
    surface.focused = true;
    surface.focus_known = true;
    let paragraph = surface
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("initial paragraph");
    let point = Point::element(paragraph, ChildIndex(0));
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
            now(0),
            Access::Edit,
            &mut view,
        )
        .expect("body click");
    (surface, doc, view)
}

#[test]
fn collaborative_typing_real_paste_and_bold_match_full_app_undo() {
    for operation in ["typing", "paste", "bold"] {
        let (mut surface, doc, mut view) = fresh_application_history();
        surface
            .apply(
                &doc,
                Input::Command {
                    command: Command::InsertText("a".into()),
                    selection: ViewSelection::KeepModel,
                },
                now(1000),
                Access::Edit,
                &mut view,
            )
            .expect("first key");
        if operation == "bold" {
            surface
                .apply(
                    &doc,
                    Input::Command {
                        command: Command::FormatText(TextFormatType::Bold),
                        selection: ViewSelection::KeepModel,
                    },
                    now(1100),
                    Access::Edit,
                    &mut view,
                )
                .expect("Ctrl+B");
        }
        let command = if operation == "paste" {
            Command::Paste(ClipboardPayload {
                data: [("text/plain".into(), "pasted".into())]
                    .into_iter()
                    .collect(),
                ..ClipboardPayload::default()
            })
        } else {
            Command::InsertText("b".into())
        };
        surface
            .apply(
                &doc,
                Input::Command {
                    command,
                    selection: ViewSelection::KeepModel,
                },
                now(1200),
                Access::Edit,
                &mut view,
            )
            .expect("second input");
        assert_eq!(
            &*surface.state().root_text_content(),
            if operation == "paste" {
                "apasted"
            } else {
                "ab"
            }
        );
        if operation == "bold" {
            let text = surface
                .state()
                .view()
                .all_text_nodes(NodeKey::ROOT)
                .last()
                .expect("bold leaf");
            assert!(
                surface
                    .state()
                    .view()
                    .text(text)
                    .expect("text data")
                    .format
                    .contains(TextFormat::BOLD)
            );
        }
        for time in [1300, 1400] {
            surface
                .apply(&doc, Input::Undo, now(time), Access::Edit, &mut view)
                .expect("actual undo");
            assert!(
                surface.state().root_text_content().is_empty(),
                "{operation}"
            );
        }
    }
}

#[test]
fn resync_restored_undo_manager_observes_the_same_host_clock() {
    let (mut surface, doc, mut view) = fresh_application_history();
    let clock = surface.history_clock.clone();
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("a".into()),
                selection: ViewSelection::KeepModel,
            },
            now(1000),
            Access::Edit,
            &mut view,
        )
        .expect("first history entry");
    assert_eq!(surface.undo.as_ref().expect("undo manager").undo_count(), 1);
    surface
        .resync(&doc, now(1100), Access::Edit, &mut view)
        .expect("real resync preserves existing manager");
    assert!(Arc::ptr_eq(&clock, &surface.history_clock));
    let mut state = surface.state().to_json().expect("current state");
    state.root["children"][0]["children"][0]["text"] = json!("ac");
    let mut tags = TagSet::default();
    tags.insert(UpdateTag::HistoryPush);
    surface
        .apply(
            &doc,
            Input::SetState { state, tags },
            now(1400),
            Access::Edit,
            &mut view,
        )
        .expect("push at exact interval boundary");
    assert_eq!(clock.load(std::sync::atomic::Ordering::Relaxed), 1400);
    assert_eq!(
        surface
            .undo
            .as_ref()
            .expect("restored manager")
            .undo_count(),
        2
    );
    surface
        .apply(&doc, Input::Undo, now(1500), Access::Edit, &mut view)
        .expect("undo second entry");
    assert_eq!(&*surface.state().root_text_content(), "a");
}
