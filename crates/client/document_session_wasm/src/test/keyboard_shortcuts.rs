//! Native hot-route conversion controls; these do not execute the JSString export.
use super::*;
use std::sync::{Arc, Mutex};

struct Keys {
    consume: bool,
    key: Arc<Mutex<Option<NodeKey>>>,
    expected: Option<KeyEvent>,
    calls: Arc<Mutex<Vec<&'static str>>>,
}
impl Plugin for Keys {
    fn name(&self) -> &'static str {
        "shortcut-events"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[
            CommandRegistration {
                command: CommandKind::KeyDown,
                priority: CommandPriority::Critical,
                placement: Placement::Before,
            },
            CommandRegistration {
                command: CommandKind::SelectAll,
                priority: CommandPriority::Editor,
                placement: Placement::After,
            },
        ]
    }
    fn handle(
        &self,
        tx: &mut Transaction<'_>,
        command: &Command,
    ) -> Result<Handled, lexical_model::Error> {
        let key = self.key.lock().expect("key").expect("actual seeded key");
        match command {
            Command::KeyDown(event) => {
                assert_eq!(Some(event), self.expected.as_ref());
                let range = tx
                    .selection()
                    .and_then(Selection::as_range)
                    .expect("admitted range");
                assert_eq!(range.anchor, Point::text(key, Utf16Offset(1)));
                assert!(tx.is_attached(key));
                self.calls.lock().expect("calls").push("keydown");
                Ok(if self.consume {
                    Handled::Yes
                } else {
                    Handled::No
                })
            }
            Command::SelectAll(event) => {
                assert_eq!(event.as_ref(), self.expected.as_ref());
                let range = tx
                    .selection()
                    .and_then(Selection::as_range)
                    .expect("same current selection");
                assert_eq!(range.anchor.key().generation(), key.generation());
                self.calls.lock().expect("calls").push("select-all");
                tx.select_all(None)?;
                Ok(Handled::Yes)
            }
            _ => Ok(Handled::No),
        }
    }
}

#[test]
fn hot_select_all_keeps_actual_event_after_unhandled_keydown_and_is_suppressed_when_handled() {
    for consume in [false, true] {
        let event = KeyEvent {
            key: "a".into(),
            code: "65".into(),
            shift: false,
            alt: false,
            ctrl: true,
            meta: false,
            repeat: true,
            is_composing: false,
        };
        let calls = Arc::new(Mutex::new(Vec::new()));
        let pending_key = Arc::new(Mutex::new(None));
        let mut editor = Editor::builder(EditorMode::ViewAttached)
            .plugin(Keys {
                consume,
                key: pending_key.clone(),
                expected: Some(event.clone()),
                calls: calls.clone(),
            })
            .build()
            .expect("editor");
        let (key, _) = editor
            .update(|tx| {
                let p = tx.create(Paragraph::default())?;
                let t = tx.create_text("abc")?;
                tx.append(NodeKey::ROOT, &[p.key()])?;
                tx.append(p, &[t.key()])?;
                tx.select_end(t)?;
                Ok(t.key())
            })
            .expect("seed");
        *pending_key.lock().expect("key") = Some(key);
        let routed = editor_input::key_command(10, &event).expect("actual hot conversion");
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
            Input::KeyDown {
                event,
                routed: Some(routed),
                routed_prevent_default: true,
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(1)),
                    focus: Point::text(key, Utf16Offset(1)),
                    resolution_dirty: false,
                },
            },
            HistoryTime(1),
        )
        .expect("key input");
        assert_eq!(
            *calls.lock().expect("calls"),
            if consume {
                vec!["keydown"]
            } else {
                vec!["keydown", "select-all"]
            }
        );
    }
}

#[test]
fn programmatic_select_all_stays_eventless_and_other_hot_commands_keep_their_mapping() {
    assert!(matches!(
        editor_input::command(10, 0, 0, None).expect("programmatic command"),
        Command::SelectAll(None)
    ));
    let event = KeyEvent {
        key: "z".into(),
        code: "90".into(),
        shift: false,
        alt: false,
        ctrl: true,
        meta: false,
        repeat: false,
        is_composing: false,
    };
    assert!(matches!(
        editor_input::key_command(13, &event).expect("undo"),
        Command::Undo
    ));
    assert!(matches!(
        editor_input::key_command(14, &event).expect("redo"),
        Command::Redo
    ));
    assert!(editor_input::key_command(u32::MAX, &event).is_err());
}

#[test]
fn direct_select_all_delivers_none_to_the_actual_model_listener() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let pending_key = Arc::new(Mutex::new(None));
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .plugin(Keys {
            consume: false,
            key: pending_key.clone(),
            expected: None,
            calls: calls.clone(),
        })
        .build()
        .expect("editor");
    let (key, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("abc")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            tx.select_end(t)?;
            Ok(t.key())
        })
        .expect("seed");
    *pending_key.lock().expect("key") = Some(key);
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
        Input::Command {
            command: editor_input::command(10, 0, 0, None).expect("programmatic"),
            selection: ViewSelection::KeepModel,
        },
        HistoryTime(1),
    )
    .expect("direct command");
    assert_eq!(*calls.lock().expect("calls"), vec!["select-all"]);
}
