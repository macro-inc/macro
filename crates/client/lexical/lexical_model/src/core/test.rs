use super::*;
mod delta;
mod events;
mod remote;
struct Typing;
impl Plugin for Typing {
    fn name(&self) -> &'static str {
        "typing"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::InsertText,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if let Command::InsertText(text) = command {
            tx.insert_text(text)?;
            return Ok(Handled::Yes);
        }
        Ok(Handled::No)
    }
}
#[test]
fn dom_first_typing_has_empty_diff_and_no_selection_effect() {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: true,
        },
    );
    let output = core
        .apply(
            Input::TextFromView {
                key: text,
                text: "ab".into(),
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
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(output.diff.ops, vec![]);
    assert_eq!(output.diff.view_text_matches, Some(text));
    assert_eq!(output.effects, vec![Effect::TextContentChanged]);
    assert_eq!(output.commits.len(), 1);
    assert_eq!(&*core.state().root_text_content(), "ab");
    assert_eq!(core.editor().mode(), EditorMode::ViewAttached);
    assert_eq!(core.composition(), Composition::Idle);
}
#[test]
fn no_listener_command_does_not_install_selection_or_consume_tags() {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    editor
        .update(|tx| {
            tx.add_tag(UpdateTag::HistoryPush);
            tx.set_selection(Some(Selection::Range(RangeSelection::at_root())))
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
    let before = core.state().selection().cloned();
    let output = core
        .apply(
            Input::Command {
                command: Command::InsertText("unhandled".into()),
                selection: ViewSelection::None,
            },
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(output.handled, Handled::No);
    assert!(output.commits.is_empty());
    assert!(output.diff.ops.is_empty());
    assert!(output.effects.is_empty());
    assert_eq!(core.state().selection(), before.as_ref());
    assert!(core.editor.carried_tags.contains(&UpdateTag::HistoryPush));
}
#[test]
fn undo_one_character_is_one_structural_text_op_with_no_full_rebuild() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
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
            history: Some(HistoryConfig::default()),
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.history
        .as_mut()
        .unwrap()
        .record(&initial, HistoryTime(0));
    let typed = core
        .apply(
            Input::Command {
                command: Command::InsertText("b".into()),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(
        typed.diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "ab".into()
        }]
    );
    assert_eq!(typed.handled, Handled::Yes);
    let undo = core.apply(Input::Undo, HistoryTime(2)).unwrap();
    assert_eq!(
        undo.diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "a".into()
        }]
    );
    assert!(undo.diff.full_reconcile);
    assert_eq!(&*core.state().root_text_content(), "a");
    assert_eq!(
        core.history().unwrap().availability(),
        HistoryAvailability {
            can_undo: false,
            can_redo: true
        }
    );
    let redo = core.apply(Input::Redo, HistoryTime(3)).unwrap();
    assert_eq!(
        redo.diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "ab".into()
        }]
    );
}
static IDS: StateKey<String> = StateKey::new("id", |value| {
    value
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_owned()
});
struct StampIds;
impl Plugin for StampIds {
    fn name(&self) -> &'static str {
        "ids"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (key, mutation) in &commit.changes.mutations {
            if *key != NodeKey::ROOT && *mutation == Mutation::Created {
                tx.set_state(*key, &IDS, format!("node-{}", key.index()))?;
            }
        }
        Ok(())
    }
}
#[test]
fn apply_created_node_receives_id_in_the_same_output_and_initial_output_drains_once() {
    let json=serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a","format":0,"detail":0,"style":"","mode":"normal"}],"format":"","direction":null,"indent":0}],"format":"","direction":null,"indent":0}})).unwrap();
    let editor = Editor::builder(EditorMode::Headless)
        .plugin(StampIds)
        .initial_state(json)
        .build()
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: false,
            diff: DiffOptions {
                include_state: true,
            },
            track_text_content: false,
        },
    );
    let initial = core.take_initial_output().unwrap();
    assert_eq!(initial.commits.len(), 1);
    assert!(!initial.diff.ops.is_empty());
    assert!(core.take_initial_output().is_none());
    let output=core.apply(Input::ApplyRemote {changes:vec![NodeChange::Create {local:LocalNode(1),json:serde_json::json!({"type":"paragraph","version":1,"children":[],"format":"","direction":null,"indent":0}).as_object().unwrap().clone()},NodeChange::Children {parent:NodeTarget::Key(NodeKey::ROOT),children:vec![NodeTarget::Local(LocalNode(1))]}],options:UpdateOptions::default()},HistoryTime(1)).unwrap();
    assert_eq!(output.commits.len(), 2);
    let key = core.state().view().first_child(NodeKey::ROOT).unwrap();
    assert_eq!(
        core.state().view().get_state(key, &IDS).unwrap(),
        format!("node-{}", key.index())
    );
    assert_eq!(
        output
            .commits
            .last()
            .unwrap()
            .next
            .view()
            .get_state(key, &IDS)
            .unwrap(),
        format!("node-{}", key.index())
    );
    assert!(
        output
            .diff
            .ops
            .iter()
            .any(|op| matches!(op,DiffOp::State {key:node,..} if *node==key))
    );
}
#[test]
fn batch_is_atomic_flushes_between_inputs_and_rejects_nested_state_changes() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
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
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output = core
        .apply(
            Input::Batch(vec![
                Input::Command {
                    command: Command::InsertText("b".into()),
                    selection: ViewSelection::KeepModel,
                },
                Input::Command {
                    command: Command::InsertText("c".into()),
                    selection: ViewSelection::KeepModel,
                },
            ]),
            HistoryTime(1),
        )
        .unwrap();
    assert_eq!(output.commits.len(), 1);
    assert_eq!(
        output.diff.ops,
        vec![DiffOp::Text {
            key: text,
            text: "abc".into()
        }]
    );
    let error = core
        .apply(Input::Batch(vec![Input::Undo]), HistoryTime(2))
        .unwrap_err();
    assert_eq!(error.error.kind(), "InputNotBatchable");
    assert!(error.committed.is_empty());
    let error = core
        .apply(
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::None,
            },
            HistoryTime(3),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "ViewSelectionInHeadless");
    assert_eq!(&*core.state().root_text_content(), "abc");
}

#[test]
fn no_op_input_does_not_advance_history_merge_clock() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
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
            history: Some(HistoryConfig::default()),
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.history
        .as_mut()
        .unwrap()
        .record(&initial, HistoryTime(0));
    core.apply(
        Input::Command {
            command: Command::InsertText("b".into()),
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(100),
    )
    .unwrap();
    let noop = core
        .apply(
            Input::InsertTextEvent {
                phase: TextEventPhase::BeforeInput,
                data: Some("x".into()),
                data_transfer_text: None,
                facts: InsertTextFacts::default(),
                last_key: None,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(250),
        )
        .unwrap();
    assert!(noop.commits.is_empty());
    core.apply(
        Input::Command {
            command: Command::InsertText("c".into()),
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(500),
    )
    .unwrap();
    assert_eq!(core.history().unwrap().undo_depth(), 2);
    assert_eq!(core.state().view().text_content(text), "abc");
}
#[test]
fn first_remote_batch_input_establishes_model_selection_for_later_commands() {
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
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.apply(
        Input::Batch(vec![
            Input::ApplyRemote {
                changes: vec![],
                options: UpdateOptions::default(),
            },
            Input::Command {
                command: Command::InsertText("x".into()),
                selection: ViewSelection::Range {
                    anchor: Point::text(text, Utf16Offset(0)),
                    focus: Point::text(text, Utf16Offset(0)),
                    resolution_dirty: false,
                },
            },
        ]),
        HistoryTime(0),
    )
    .unwrap();
    assert_eq!(&*core.state().root_text_content(), "abcx");
}

struct PublishThenError;
impl Plugin for PublishThenError {
    fn name(&self) -> &'static str {
        "early"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::ClearEditor,
            priority: CommandPriority::Normal,
            placement: Placement::After,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        let saved = tx.committed_state().clone();
        let text = tx
            .first_descendant(NodeKey::ROOT)
            .ok_or(Error::Invariant("text"))?;
        tx.text(text)?.set_text_content("early publication")?;
        tx.set_editor_state(saved, TagSet::default())?;
        Err(Error::Invariant("after early commit"))
    }
}
#[test]
fn apply_error_retains_early_publication_and_reports_its_commit() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(PublishThenError)
        .build()
        .unwrap();
    editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("before")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: Some(HistoryConfig::default()),
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let error = core
        .apply(
            Input::Command {
                command: Command::ClearEditor,
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(1),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "Invariant");
    assert_eq!(error.committed.len(), 1);
    assert_eq!(
        &*error.committed[0].next.root_text_content(),
        "early publication"
    );
    assert_eq!(&*core.state().root_text_content(), "early publication");
}

static EMIT_ONLY: CommandKey<()> = CommandKey::new("emit-only");
static NOTIFICATION: EventKey<u32> = EventKey::new("notification");
static EMIT_REGISTRATION: [CommandRegistration; 1] = [CommandRegistration {
    command: CommandKind::Extension(&EMIT_ONLY),
    priority: CommandPriority::Normal,
    placement: Placement::After,
}];
struct EmitOnly;
impl Plugin for EmitOnly {
    fn name(&self) -> &'static str {
        "emit-only"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &EMIT_REGISTRATION
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        tx.emit(&NOTIFICATION, 7);
        Ok(Handled::Yes)
    }
}
#[test]
fn event_only_command_is_published_without_advancing_history_merge_clock() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Typing)
        .plugin(EmitOnly)
        .build()
        .unwrap();
    let (text, initial) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a")?;
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
            history: Some(HistoryConfig::default()),
            editable: true,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    core.history
        .as_mut()
        .unwrap()
        .record(&initial, HistoryTime(0));
    core.apply(
        Input::Command {
            command: Command::InsertText("b".into()),
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(100),
    )
    .unwrap();
    let noop = core
        .apply(
            Input::Command {
                command: Command::Extension(ExtensionCommand::new(&EMIT_ONLY, ())),
                selection: ViewSelection::KeepModel,
            },
            HistoryTime(250),
        )
        .unwrap();
    assert_eq!(noop.commits.len(), 1);
    assert_eq!(
        noop.commits[0]
            .events_of(&NOTIFICATION)
            .copied()
            .collect::<Vec<_>>(),
        vec![7]
    );
    assert!(noop.diff.ops.is_empty());
    core.apply(
        Input::Command {
            command: Command::InsertText("c".into()),
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(500),
    )
    .unwrap();
    assert_eq!(core.history().unwrap().undo_depth(), 2);
    assert_eq!(core.state().view().text_content(text), "abc");
}

#[test]
fn batch_selection_metadata_reports_only_actual_installation() {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Typing)
        .build()
        .unwrap();
    let (text, _) = editor
        .update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("a")?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            tx.append(paragraph, &[text.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::new(
                Point::text(text, Utf16Offset(1)),
                Point::text(text, Utf16Offset(1)),
            ))))?;
            Ok(text.key())
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
            Input::Batch(vec![
                Input::ApplyRemote {
                    changes: vec![],
                    options: UpdateOptions::default(),
                },
                Input::Command {
                    command: Command::InsertText("x".into()),
                    selection: ViewSelection::None,
                },
            ]),
            HistoryTime(0),
        )
        .unwrap();
    assert!(output.installed_selection.is_none());
    assert_eq!(core.state().view().text_content(text), "ax");
    assert_eq!(
        core.state()
            .selection()
            .unwrap()
            .as_range()
            .unwrap()
            .anchor
            .offset(),
        2
    );
}
