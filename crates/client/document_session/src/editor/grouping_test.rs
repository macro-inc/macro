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
    // Native-authored Source-rule fixture: pin the root id so this table history
    // test is independent of post-reconcile mint timing. Exact JSON below is derived
    // from this input and Source import rules, not a captured Source export.
    let doc = lexical_loro::new_doc(7).expect("Loro document");
    let mut view = Vec::new();
    surface
        .init(&doc, now(0), Access::Edit, &mut view)
        .expect("initialize");
    surface.apply(&doc, Input::SetState {
        state: serde_json::from_value(json!({"root":{"type":"root","$":{"id":"ROOTid01"},"children":[{"type":"paragraph","children":[{"type":"text","text":"base"}]}]}})).expect("initial model"),
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
    assert_eq!(surface.state().to_json().expect("undo JSON"), {
        // Source undo/redo probe log 8803f2b1 (probe a5c2a8e1 on harness a649c789): after a
        // Loro-driven import every storage-null key a node holds absent reads null, touched or
        // not, while text mode stays undefined. Literal drafted from this test's pre-import
        // state by that rule.
        serde_json::from_str::<SerializedEditorState>(
                r#"{"root":{"children":[{"children":[{"text":"base","type":"text","version":1,"$":{"id":"N-OHZRWQ"},"detail":null,"format":null,"style":null}],"format":"","type":"paragraph","version":1,"$":{"id":"RALpOnRU"},"direction":null,"indent":null,"textFormat":null,"textStyle":null}],"format":"","type":"root","version":1,"$":{"id":"ROOTid01","documentMetadata":{"version":11}}}}"#,
            )
                .expect("Source-rule literal")
    });
    surface
        .apply(&doc, Input::Redo, now(300), Access::Edit, &mut view)
        .expect("redo resize");
    // Source's redo recreates the inserted nodes from Loro, where their undefined
    // fields are stored as null, and its whole-tree reconcile gives every other
    // node its stored null too (probe logs d783e505 and 8803f2b1).
    assert_eq!(surface.state().to_json().expect("redo JSON"), {
        // Source undo/redo probe log 8803f2b1 (probe a5c2a8e1 on harness a649c789): after a
        // Loro-driven import every storage-null key a node holds absent reads null, touched or
        // not, while text mode stays undefined. Literal drafted from this test's pre-import
        // state by that rule.
        serde_json::from_str::<SerializedEditorState>(
                r#"{"root":{"children":[{"children":[{"text":"base","type":"text","version":1,"$":{"id":"N-OHZRWQ"},"detail":null,"format":null,"style":null}],"format":"","type":"paragraph","version":1,"$":{"id":"RALpOnRU"},"direction":null,"indent":null,"textFormat":null,"textStyle":null},{"children":[{"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"$":{"id":"HGSFJif7"},"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"tablecell","version":1,"$":{"id":"XZHQbVZX"},"backgroundColor":null,"colSpan":1,"headerState":0,"rowSpan":1},{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"$":{"id":"ZsfiuPd1"},"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"tablecell","version":1,"$":{"id":"N-TehWzD"},"backgroundColor":null,"colSpan":1,"headerState":0,"rowSpan":1}],"direction":null,"format":"","indent":0,"type":"tablerow","version":1,"$":{"id":"WN7eT1BU"}}],"direction":null,"format":"","indent":0,"type":"table","version":1,"$":{"id":"lSqSp5z_"},"colWidths":[210,160]},{"children":[],"format":"","type":"paragraph","version":1,"$":{"id":"Q_DWqp0L"},"textFormat":0,"textStyle":"","direction":null,"indent":null}],"format":"","type":"root","version":1,"$":{"id":"ROOTid01","documentMetadata":{"version":11}}}}"#,
            )
                .expect("Source-rule literal")
    });
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
        surface
            .apply(&doc, Input::Undo, now(300), Access::Edit, &mut view)
            .expect("undo");
        assert_eq!(
            surface.state().to_json().expect("undo JSON"),
            {
                // Source undo/redo probe log 8803f2b1 (probe a5c2a8e1 on harness a649c789): after a
                // Loro-driven import every storage-null key a node holds absent reads null, touched or
                // not, while text mode stays undefined. Literal drafted from this test's pre-import
                // state by that rule.
                serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"text":"a","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null,"format":null,"style":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"direction":null,"indent":null,"textFormat":null,"textStyle":null}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal")
            },
            "{operation:?}"
        );
        surface
            .apply(&doc, Input::Redo, now(300), Access::Edit, &mut view)
            .expect("redo");
        assert_eq!(
            surface.state().to_json().expect("redo JSON"),
            {
                // Source undo/redo probe log 8803f2b1 (probe a5c2a8e1 on harness a649c789): after a
                // Loro-driven import every storage-null key a node holds absent reads null, touched or
                // not, while text mode stays undefined. Literal drafted from this test's pre-import
                // state by that rule.
                match operation {
                Operation::Typing => serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"format":0,"style":"","text":"abc","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"textFormat":0,"textStyle":"","direction":null,"indent":null}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal"),
                Operation::Paste => serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"format":0,"style":"","text":"abpasted","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"textFormat":0,"textStyle":"","direction":null,"indent":null}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal"),
                Operation::Format => serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"format":1,"style":"","text":"ab","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"textFormat":1,"textStyle":"","direction":null,"indent":null}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal"),
                Operation::NodeInsert => serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"format":0,"style":"","text":"ab","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"textFormat":0,"textStyle":"","direction":null,"indent":null},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"new","type":"text","version":1,"$":{"id":"session-7-4"}}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"$":{"id":"session-7-3"},"textFormat":0,"textStyle":""}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal"),
                Operation::ExplicitPush => serde_json::from_str::<SerializedEditorState>(
                    r#"{"root":{"children":[{"children":[{"format":0,"style":"","text":"abc","type":"text","version":1,"$":{"id":"session-7-2"},"detail":null}],"format":"","type":"paragraph","version":1,"$":{"id":"session-7-1"},"textFormat":0,"textStyle":"","direction":null,"indent":null}],"format":"","type":"root","version":1,"$":{"id":"session-7-root-1"}}}"#,
                )
                    .expect("Source-rule literal"),
                }
            },
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

/// Undo removes the code block and its caret: the awareness cannot resolve, so
/// the selection stays cleared until the browser reports one. Redo recreates
/// the block, and Source's awareness restore then resolves again: its Loro
/// cursor into the deleted text still yields its offset (loro-crdt 1.16.3), and
/// the recreated node keeps its id (CollabProvider.tsx:243-262, cursor.ts:303).
/// Browser feedback after undo replaces the awareness with a paragraph point
/// that redo removes, so that redo restores nothing.
/// Source's side is derived from a loro-crdt 1.16.3 probe plus Source's code,
/// not a mounted CollabProvider run.
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
            let restored = time == 101 && !feedback;
            if restored {
                let code_text = surface
                    .state()
                    .view()
                    .all_text_nodes(NodeKey::ROOT)
                    .next()
                    .expect("recreated code text");
                let caret = Point::text(code_text, Utf16Offset(31));
                assert_eq!(
                    view_selection(surface.state().selection()),
                    ViewSelection::Range {
                        anchor: caret,
                        focus: caret,
                        resolution_dirty: false,
                    }
                );
            } else {
                assert_eq!(surface.state().selection(), None);
            }
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
            assert_eq!(
                view.iter()
                    .any(|effect| matches!(effect, ViewEffect::HistoryAwarenessSelection { .. })),
                restored
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
    // The load group is an undo item before the edit (write-path-3 5f5e1b4e, 414abf76).
    assert_eq!(surface.undo.as_ref().expect("undo manager").undo_count(), 2);
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
        // The load group, the first edit and the pushed state (write-path-3 5f5e1b4e).
        3
    );
    surface
        .apply(&doc, Input::Undo, now(1500), Access::Edit, &mut view)
        .expect("undo second entry");
    assert_eq!(&*surface.state().root_text_content(), "a");
}

#[test]
fn deleting_a_table_row_undoes_the_open_document_edit_boundary()
-> Result<(), Box<dyn std::error::Error>> {
    use macro_document_model::EditorType;

    for reopen in [false, true] {
        let config = crate::application::application_editor_config(
            EditorConfig::default(),
            Arc::new(AtomicI64::new(0)),
            EditorType::MarkdownSync,
        );
        let mut doc = lexical_loro::new_doc(7)?;
        let mut surface = EditorSurface::new(config.clone(), 7, now(0))?;
        let mut view = Vec::new();
        surface.init(&doc, now(0), Access::Edit, &mut view)?;
        surface.apply(
            &doc,
            Input::SetState {
                state: serde_json::from_str(include_str!(
                    "../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"
                ))?,
                tags: TagSet::default(),
            },
            now(1),
            Access::Edit,
            &mut view,
        )?;

        if reopen {
            let snapshot = doc.export(loro::ExportMode::Snapshot)?;
            doc = lexical_loro::new_doc(8)?;
            doc.import(&snapshot)?;
            surface = EditorSurface::new(config, 8, now(20))?;
            surface.init(&doc, now(20), Access::Edit, &mut view)?;
        }
        let state = surface.state().view();
        let table = state.first_child(NodeKey::ROOT).expect("loaded table");
        let rows = state.children_keys(table)?;
        let cell = state.first_child(rows[1]).expect("second-row cell");
        let command = macro_document_model::surface::decode_command(
            "group-b.table",
            &json!({"action":"delete","cell":cell.index(),"axis":"row"}).to_string(),
            cell.generation(),
            None,
        )?
        .expect("registered delete-row action");
        let before = surface.state().to_json()?;
        surface.apply(
            &doc,
            Input::Command {
                command,
                selection: ViewSelection::KeepModel,
            },
            now(76),
            Access::Edit,
            &mut view,
        )?;
        assert_eq!(surface.state().view().children_keys(table)?.len(), 2);

        surface.apply(&doc, Input::Undo, now(80), Access::Edit, &mut view)?;
        if reopen {
            // Pristine app reloads the persisted table before deletion. Its first
            // Undo restores all nine cells and the second has no earlier edit.
            assert_eq!(surface.state().to_json()?, before);
            surface.apply(&doc, Input::Undo, now(81), Access::Edit, &mut view)?;
            assert_eq!(surface.state().to_json()?, before);
        } else {
            // The full app merges a row deletion 75 ms after the table insert.
            assert!(
                !surface
                    .state()
                    .view()
                    .children(NodeKey::ROOT)
                    .any(|key| { surface.state().view().type_name(key).ok() == Some("table") })
            );
        }
    }
    Ok(())
}

/// A wall clock before the Unix epoch is a host error. The input fails before it changes the
/// model, the document, the undo history or the merge tracker.
#[test]
fn a_wall_clock_before_the_epoch_fails_the_input_and_changes_nothing() {
    let at = |mono: u64, wall: i64| Now {
        mono: doc_sync_core::Millis(mono),
        wall: doc_sync_core::UnixMillis(wall),
    };
    let (mut surface, doc, mut view) = fresh_application_history();
    let type_at = |surface: &mut EditorSurface, view: &mut Vec<ViewEffect>, text: &str, now| {
        surface.apply(
            &doc,
            Input::Command {
                command: Command::InsertText(text.into()),
                selection: ViewSelection::KeepModel,
            },
            now,
            Access::Edit,
            view,
        )
    };
    type_at(&mut surface, &mut view, "a", at(1_000, 1_000)).expect("type a");
    let version = doc.oplog_vv();
    let availability = surface.history();
    let refused = type_at(&mut surface, &mut view, "x", at(1_050, -1));
    assert!(
        matches!(refused, Err(SessionError::Configuration(_))),
        "{refused:?}"
    );
    assert_eq!(&*surface.state().root_text_content(), "a");
    assert_eq!(doc.oplog_vv(), version);
    assert_eq!(surface.history(), availability);
    // The tracker still holds 'a' at wall 1000, so 'b' 100 ms later merges with it.
    type_at(&mut surface, &mut view, "b", at(1_100, 1_100)).expect("type b");
    surface
        .apply(
            &doc,
            Input::Undo,
            at(50_000, 50_000),
            Access::Edit,
            &mut view,
        )
        .expect("undo");
    assert_eq!(&*surface.state().root_text_content(), "");
}

/// Source groups typing for undo by `Date.now` alone (registerLoroHistory's
/// getMergeAction and Loro's mergeInterval both read it), so only the wall
/// clock decides; the host's monotonic clock must not.
/// Source rows: apps/web applyAiOps.source-controls.test.ts ('typing undo
/// follows the wall clock').
#[test]
fn typing_history_groups_by_the_wall_clock_like_source() {
    let at = |mono: u64, wall: i64| Now {
        mono: doc_sync_core::Millis(mono),
        wall: doc_sync_core::UnixMillis(wall),
    };
    let mut rows = Vec::new();
    for (mono_gap, wall_gap) in [(100, 100), (100, 10_000), (10_000, 100), (10_000, -500)] {
        let (mut surface, doc, mut view) = fresh_application_history();
        for (character, time) in [
            ("a", at(1_000, 1_000)),
            ("b", at(1_000 + mono_gap, 1_000 + wall_gap)),
        ] {
            surface
                .apply(
                    &doc,
                    Input::Command {
                        command: Command::InsertText(character.into()),
                        selection: ViewSelection::KeepModel,
                    },
                    time,
                    Access::Edit,
                    &mut view,
                )
                .expect("type");
        }
        assert_eq!(&*surface.state().root_text_content(), "ab");
        surface
            .apply(
                &doc,
                Input::Undo,
                at(50_000, 50_000),
                Access::Edit,
                &mut view,
            )
            .expect("undo");
        rows.push((
            mono_gap,
            wall_gap,
            surface.state().root_text_content().to_string(),
        ));
    }
    // One undo removes both characters when merged, only "b" when split.
    assert_eq!(
        rows,
        vec![
            (100, 100, String::new()),
            (100, 10_000, "a".to_string()),
            (10_000, 100, String::new()),
            // The wall clock moved back: a negative delta merges in Source too
            // (applyAiOps.source-controls.test.ts 'typing undo follows the wall clock').
            (10_000, -500, String::new()),
        ]
    );
}

#[test]
fn undo_after_resync_restores_the_selection_before_the_edit() {
    let config = crate::application::application_editor_config(
        EditorConfig::default(),
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
        .resync(&doc, now(100), Access::Edit, &mut view)
        .expect("resync keeps the history manager");
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::InsertText("X".into()),
                selection: at(1),
            },
            now(500),
            Access::Edit,
            &mut view,
        )
        .expect("type after resync");
    assert_eq!(surface.state().root_text_content().as_ref(), "aXbc");
    let text = surface
        .state()
        .view()
        .all_text_nodes(NodeKey::ROOT)
        .next()
        .expect("text after typing");
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
            now(550),
            Access::Edit,
            &mut view,
        )
        .expect("move the caret away from the edit");
    assert!(
        surface
            .apply(&doc, Input::Undo, now(600), Access::Edit, &mut view)
            .expect("undo after resync")
    );
    assert_eq!(surface.state().root_text_content().as_ref(), "abc");
    assert_eq!(view_selection(surface.state().selection()), at(1));
}

/// Source's localCursorUpdate (CollabProvider.tsx:296) converts only range and
/// node selections (cursor.ts:84); a table selection leaves the local awareness,
/// and with it presence, at its previous value. Browser history then restores
/// that earlier awareness after undo, not the table's cells.
#[test]
fn a_table_selection_keeps_the_previous_awareness_through_undo()
-> Result<(), Box<dyn std::error::Error>> {
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
    let mut surface = EditorSurface::new(config, 7, now(0))?;
    let doc = lexical_loro::new_doc(7)?;
    let mut view = Vec::new();
    surface.init(&doc, now(0), Access::Edit, &mut view)?;
    surface.apply(
        &doc,
        Input::SetState {
            state: serde_json::from_str(include_str!(
                "../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"
            ))?,
            tags: TagSet::default(),
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    surface.apply(
        &doc,
        Input::Command {
            command: Command::ClearHistory,
            selection: ViewSelection::KeepModel,
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    let state = surface.state().view();
    let table = state.first_child(NodeKey::ROOT).expect("loaded table");
    let rows = state.children_keys(table)?;
    let first_row = state.children_keys(rows[0])?;
    let second_row = state.children_keys(rows[1])?;
    let text = state
        .all_text_nodes(first_row[0])
        .next()
        .expect("first cell text");
    let caret = Point::text(text, Utf16Offset(2));
    let caret_selection = ViewSelection::Range {
        anchor: caret,
        focus: caret,
        resolution_dirty: false,
    };
    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: caret_selection.clone(),
            change: None,
        },
        now(10),
        Access::Edit,
        &mut view,
    )?;
    let caret_awareness = surface.selection_cursors();
    assert!(caret_awareness.is_some());

    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: ViewSelection::Table {
                table,
                anchor_cell: second_row[0],
                focus_cell: second_row[1],
            },
            change: None,
        },
        now(20),
        Access::Edit,
        &mut view,
    )?;
    assert!(surface.state().selection().is_some_and(Selection::is_table));
    // Presence publishes these cursors: peers keep seeing the earlier caret.
    assert_eq!(surface.selection_cursors(), caret_awareness);

    // A resize leaves the table selection in place, so the awareness the undo
    // restores is still the caret from before the table selection.
    let command = macro_document_model::surface::decode_command(
        "group-b.table",
        &json!({"action":"resize-column","table":table.index(),"column":0,"baseWidths":[160,160,160],"delta":40.0,"merge":false}).to_string(),
        table.generation(),
        None,
    )?
    .expect("registered resize action");
    surface.apply(
        &doc,
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        now(1_000),
        Access::Edit,
        &mut view,
    )?;
    assert!(surface.state().selection().is_some_and(Selection::is_table));
    assert_eq!(surface.selection_cursors(), caret_awareness);

    let resized = surface.state().to_json()?;
    surface.apply(&doc, Input::Undo, now(2_000), Access::Edit, &mut view)?;
    assert_ne!(surface.state().to_json()?, resized);
    assert_eq!(view_selection(surface.state().selection()), caret_selection);
    Ok(())
}

/// Source's localCursorUpdate returns before converting a null selection
/// (CollabProvider.tsx:291), so the local awareness, and with it presence, keeps
/// the previous caret.
#[test]
fn a_null_selection_keeps_the_previous_awareness() -> Result<(), Box<dyn std::error::Error>> {
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
    let mut surface = EditorSurface::new(config, 7, now(0))?;
    let doc = lexical_loro::new_doc(7)?;
    let mut view = Vec::new();
    surface.init(&doc, now(0), Access::Edit, &mut view)?;
    surface.apply(
        &doc,
        Input::SetState {
            state: serde_json::from_str(include_str!(
                "../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"
            ))?,
            tags: TagSet::default(),
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    surface.apply(
        &doc,
        Input::Command {
            command: Command::ClearHistory,
            selection: ViewSelection::KeepModel,
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    let state = surface.state().view();
    let table = state.first_child(NodeKey::ROOT).expect("loaded table");
    let rows = state.children_keys(table)?;
    let first_row = state.children_keys(rows[0])?;
    let text = state
        .all_text_nodes(first_row[0])
        .next()
        .expect("first cell text");
    let caret = Point::text(text, Utf16Offset(2));
    let caret_selection = ViewSelection::Range {
        anchor: caret,
        focus: caret,
        resolution_dirty: false,
    };
    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: caret_selection.clone(),
            change: None,
        },
        now(10),
        Access::Edit,
        &mut view,
    )?;
    let caret_awareness = surface.selection_cursors();
    assert!(caret_awareness.is_some());

    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: ViewSelection::None,
            change: None,
        },
        now(20),
        Access::Edit,
        &mut view,
    )?;
    assert_eq!(surface.state().selection(), None);
    // Presence publishes these cursors: peers keep seeing the earlier caret.
    assert_eq!(surface.selection_cursors(), caret_awareness);

    Ok(())
}

/// Source's node-selection conversion (cursor.ts:114) never yields cursors: a
/// node's container is its LoroMap, neither LoroText nor LoroMovableList, so
/// localCursorUpdate keeps the previous awareness (and presence), and browser
/// history restores that caret after undo.
#[test]
fn a_node_selection_keeps_the_previous_awareness_through_undo()
-> Result<(), Box<dyn std::error::Error>> {
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
    let mut surface = EditorSurface::new(config, 7, now(0))?;
    let doc = lexical_loro::new_doc(7)?;
    let mut view = Vec::new();
    surface.init(&doc, now(0), Access::Edit, &mut view)?;
    surface.apply(
        &doc,
        Input::SetState {
            state: serde_json::from_str(include_str!(
                "../../../lexical/macro_document_model/src/plugins_group_b/table/actions/fixtures/before.json"
            ))?,
            tags: TagSet::default(),
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    surface.apply(
        &doc,
        Input::Command {
            command: Command::ClearHistory,
            selection: ViewSelection::KeepModel,
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    let state = surface.state().view();
    let table = state.first_child(NodeKey::ROOT).expect("loaded table");
    let rows = state.children_keys(table)?;
    let first_row = state.children_keys(rows[0])?;
    let text = state
        .all_text_nodes(first_row[0])
        .next()
        .expect("first cell text");
    let caret = Point::text(text, Utf16Offset(2));
    let caret_selection = ViewSelection::Range {
        anchor: caret,
        focus: caret,
        resolution_dirty: false,
    };
    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: caret_selection.clone(),
            change: None,
        },
        now(10),
        Access::Edit,
        &mut view,
    )?;
    let caret_awareness = surface.selection_cursors();
    assert!(caret_awareness.is_some());

    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: ViewSelection::Node(vec![table]),
            change: None,
        },
        now(20),
        Access::Edit,
        &mut view,
    )?;
    assert!(surface.state().selection().is_some_and(Selection::is_node));
    // Presence publishes these cursors: peers keep seeing the earlier caret.
    assert_eq!(surface.selection_cursors(), caret_awareness);

    // A resize leaves the node selection in place, so the awareness the undo
    // restores is still the caret from before the node selection.
    let command = macro_document_model::surface::decode_command(
        "group-b.table",
        &json!({"action":"resize-column","table":table.index(),"column":0,"baseWidths":[160,160,160],"delta":40.0,"merge":false}).to_string(),
        table.generation(),
        None,
    )?
    .expect("registered resize action");
    surface.apply(
        &doc,
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        now(1_000),
        Access::Edit,
        &mut view,
    )?;
    assert!(surface.state().selection().is_some_and(Selection::is_node));
    assert_eq!(surface.selection_cursors(), caret_awareness);

    let resized = surface.state().to_json()?;
    surface.apply(&doc, Input::Undo, now(2_000), Access::Edit, &mut view)?;
    assert_ne!(surface.state().to_json()?, resized);
    assert_eq!(view_selection(surface.state().selection()), caret_selection);
    Ok(())
}

/// Source's localCursorUpdate also returns when a range point has no Loro
/// cursor (CollabProvider.tsx:303; cursor.ts:101). A point on a completion,
/// which never reaches Loro, keeps the previous awareness and presence.
#[test]
fn an_unconvertible_range_keeps_the_previous_awareness() -> Result<(), Box<dyn std::error::Error>> {
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
    let mut surface = EditorSurface::new(config, 7, now(0))?;
    let doc = lexical_loro::new_doc(7)?;
    let mut view = Vec::new();
    surface.init(&doc, now(0), Access::Edit, &mut view)?;
    surface.apply(
        &doc,
        Input::SetState {
            state: serde_json::from_value(json!({"root":{"type":"root","version":1,"children":[
                {"type":"paragraph","version":1,"children":[
                    {"type":"text","version":1,"text":"abc"},
                    {"type":"completion","version":1,"text":"local completion"}
                ]}
            ]}}))?,
            tags: TagSet::default(),
        },
        now(0),
        Access::Edit,
        &mut view,
    )?;
    let state = surface.state().view();
    let paragraph = state.first_child(NodeKey::ROOT).expect("paragraph");
    let children = state.children_keys(paragraph)?;
    let caret = Point::text(children[0], Utf16Offset(2));
    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: caret,
                focus: caret,
                resolution_dirty: false,
            },
            change: None,
        },
        now(10),
        Access::Edit,
        &mut view,
    )?;
    let caret_awareness = surface.selection_cursors();
    assert!(caret_awareness.is_some());

    let completion = Point::element(children[1], lexical_model::ChildIndex(0));
    surface.apply(
        &doc,
        Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: completion,
                focus: completion,
                resolution_dirty: false,
            },
            change: None,
        },
        now(20),
        Access::Edit,
        &mut view,
    )?;
    let range = surface
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range on the completion");
    assert_eq!((range.anchor, range.focus), (completion, completion));
    // Presence publishes these cursors: peers keep seeing the earlier caret.
    assert_eq!(surface.selection_cursors(), caret_awareness);
    Ok(())
}

/// Source's from-Loro update clears the selection, then its queued update
/// rebuilds a range from the local awareness whenever it resolves, whatever the
/// model selection was (CollabProvider.tsx:243-262). A null selection keeps the
/// awareness (:291), so undo restores the caret from before it. An unfocused
/// editor restores the model selection under skip-dom-selection, without
/// taking the DOM selection. Derived from Source's code, not a mounted
/// CollabProvider run.
#[test]
fn browser_history_restores_awareness_over_a_null_selection()
-> Result<(), Box<dyn std::error::Error>> {
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
        let mut surface = EditorSurface::new(config, 7, now(0))?;
        let doc = lexical_loro::new_doc(7)?;
        let mut view = Vec::new();
        surface.init(&doc, now(0), Access::Edit, &mut view)?;
        surface.apply(
            &doc,
            Input::SetState {
                state: serde_json::from_value(
                    json!({"root":{"type":"root","$":{"id":"root-id"},"children":[
                        {"type":"paragraph","children":[{"type":"text","text":"abc"}]}
                    ]}}),
                )?,
                tags: TagSet::default(),
            },
            now(0),
            Access::Edit,
            &mut view,
        )?;
        surface.apply(
            &doc,
            Input::Command {
                command: Command::ClearHistory,
                selection: ViewSelection::KeepModel,
            },
            now(0),
            Access::Edit,
            &mut view,
        )?;
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
        surface.apply(
            &doc,
            Input::Command {
                command: Command::InsertText("X".into()),
                selection: at(2),
            },
            now(500),
            Access::Edit,
            &mut view,
        )?;
        surface.apply(
            &doc,
            Input::SelectionFromView {
                selection: ViewSelection::None,
                change: None,
            },
            now(510),
            Access::Edit,
            &mut view,
        )?;
        assert_eq!(surface.state().selection(), None);
        assert!(surface.selection_cursors().is_some());

        surface.focus_known = true;
        surface.focused = focused;
        view.clear();
        surface.apply(&doc, Input::Undo, now(600), Access::Edit, &mut view)?;
        assert_eq!(surface.state().root_text_content().as_ref(), "abc");
        // The awareness caret after X, at 3 in "abXc", follows its Loro cursor to 2.
        assert_eq!(view_selection(surface.state().selection()), at(2));
        assert!(view.iter().any(|effect| matches!(effect,
            ViewEffect::HistoryAwarenessSelection { selection, write_dom, .. }
                if selection == &at(2) && *write_dom == focused
        )));
        assert!(view.iter().any(|effect| matches!(effect,
            ViewEffect::CommitTags(tags) if tags.iter().any(|tag| tag == "collab-selection")
                && tags.iter().any(|tag| tag == "skip-dom-selection") != focused
        )));
        // No range reaches the DOM selection except through the restore above.
        assert!(!view.iter().any(|effect| matches!(
            effect,
            ViewEffect::Editor(Effect::SetViewSelection {
                selection: ViewSelection::Range { .. },
                ..
            })
        )));
    }
    Ok(())
}
