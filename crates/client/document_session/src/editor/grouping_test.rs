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
fn table_resize_within_delay_undo_keeps_table_and_redo_keeps_all_moves() {
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
    assert!(
        surface.state().view().is_attached(table),
        "undo removed the table rather than its resize"
    );
    assert_eq!(surface.state().to_json().expect("undo JSON"), before);
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
fn short_delay_typing_merges_but_paste_format_node_and_explicit_push_do_not() {
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
        let before = surface.state().to_json().expect("before JSON");
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
            if operation == Operation::Typing {
                base
            } else {
                before
            },
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
