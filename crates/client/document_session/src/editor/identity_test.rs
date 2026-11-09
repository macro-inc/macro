use super::*;

#[test]
fn default_code_subtree_redo_preserves_every_durable_id() {
    code_subtree_redo(EditorConfig::default(), "code");
}

#[test]
fn application_code_subtree_redo_preserves_every_durable_id() {
    code_subtree_redo(
        EditorConfig {
            builder: Arc::new(|_, _| {
                macro_document_model::node_ids::NodeIdPlugin::register(
                    register_editor_commands(macro_document_model::preset_builder(
                        macro_document_model::EditorType::MarkdownSync,
                    )),
                    &["root", "paragraph", "text", "custom-code"],
                    None,
                    [7; 32],
                )
            }),
            policy: &macro_document_model::sync::MACRO_SYNC_POLICY,
            ..EditorConfig::default()
        },
        "custom-code",
    );
}

static DUPLICATE: CommandKey<String> = CommandKey::new("duplicate-live-leaf");
struct DuplicateLiveLeaf;
impl Plugin for DuplicateLiveLeaf {
    fn name(&self) -> &'static str {
        "duplicate-live-leaf"
    }
    fn commands(&self) -> &[CommandRegistration] {
        static COMMANDS: [CommandRegistration; 1] = [CommandRegistration {
            command: CommandKind::Extension(&DUPLICATE),
            priority: CommandPriority::Critical,
            placement: Placement::After,
        }];
        &COMMANDS
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let Command::Extension(command) = command else {
            return Ok(Handled::No);
        };
        let Some(id) = command.payload(&DUPLICATE) else {
            return Ok(Handled::No);
        };
        let paragraph = tx.create(Paragraph::default())?;
        let leaf = tx.create_text("other")?;
        tx.set_state(leaf, &builder::ID, id.clone())?;
        tx.append(paragraph, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(Handled::Yes)
    }
}

fn code_subtree_redo(mut config: EditorConfig, code_type: &str) {
    let factory = config.builder.clone();
    config.builder = Arc::new(move |mode, peer| factory(mode, peer).plugin(DuplicateLiveLeaf));
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let mut surface = EditorSurface::new(config, 7, now).unwrap();
    let doc = lexical_loro::new_doc(7).unwrap();
    let mut view = vec![];
    surface.init(&doc, now, Access::Edit, &mut view).unwrap();
    surface.focused = true;
    surface.focus_known = true;
    surface.apply(&doc, Input::SetState {
        state: serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[]}]}})).unwrap(),
        tags: TagSet::default(),
    }, now, Access::Edit, &mut view).unwrap();
    let paragraph = surface
        .state()
        .view()
        .children(NodeKey::ROOT)
        .next()
        .unwrap();
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
    surface.apply(&doc, Input::SetState {
        state: serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[
            {"type":code_type,"children":[{"type":"text","text":"const localValue = 1;"}]},
            {"type":"paragraph","children":[]}
        ]}})).unwrap(),
        tags: TagSet::default(),
    }, now, Access::Edit, &mut view).unwrap();
    let code = surface
        .state()
        .view()
        .children(NodeKey::ROOT)
        .next()
        .unwrap();
    let leaf = surface.state().view().children(code).next().unwrap();
    let point = Point::text(leaf, Utf16Offset(21));
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
    let typed = surface.state().to_json().unwrap();
    assert_eq!(
        typed.root["children"][0]["children"][0]["text"],
        "const localValue = 1;x"
    );
    assert_eq!(surface.undo.as_ref().unwrap().undo_count(), 1);
    for _ in 0..2 {
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
                    routed_prevent_default: true,
                    selection: ViewSelection::KeepModel,
                },
                now,
                Access::Edit,
                &mut view,
            )
            .unwrap();
        let undone = surface.state().to_json().unwrap();
        assert_eq!(undone.root["children"].as_array().unwrap().len(), 1);
        assert_eq!(undone.root["children"][0]["type"], "paragraph");
        surface
            .apply(
                &doc,
                Input::KeyDown {
                    event: KeyEvent {
                        key: "Z".into(),
                        ctrl: true,
                        shift: true,
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
        assert_eq!(surface.state().to_json().unwrap(), typed);
        let selection = surface.state().selection().unwrap().as_range().unwrap();
        assert_eq!(selection.anchor.offset(), 22);
        assert_eq!(selection.focus.offset(), 22);
        let selected = surface
            .state()
            .view()
            .export_json(selection.anchor.key())
            .unwrap();
        assert_eq!(
            selected["$"]["id"],
            typed.root["children"][0]["children"][0]["$"]["id"]
        );
    }
    // A different attached node still cannot claim the restored leaf identity.
    let id = typed.root["children"][0]["children"][0]["$"]["id"].clone();
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::Extension(ExtensionCommand::new(
                    &DUPLICATE,
                    id.as_str().unwrap().to_owned(),
                )),
                selection: ViewSelection::KeepModel,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    let actual = surface.state().to_json().unwrap();
    assert_eq!(actual.root["children"][0]["children"][0]["$"]["id"], id);
    assert_ne!(actual.root["children"][2]["children"][0]["$"]["id"], id);
}
