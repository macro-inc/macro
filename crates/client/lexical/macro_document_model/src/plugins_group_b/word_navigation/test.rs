use super::*;
use crate::nodes::{CustomCodeNode, UserMentionNode};
use std::sync::{Arc, Mutex};

fn fixture(host: ViewHost) -> Result<(Editor, NodeKey, NodeKey), Error> {
    let mut editor = register(
        Editor::builder(EditorMode::ViewAttached)
            .node::<UserMentionNode>()
            .node::<CodeNode>()
            .node::<CustomCodeNode>()
            .view_host(host),
    )
    .build()
    .expect("word policy builder");
    let ((paragraph, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let mention = tx.create(UserMentionNode {
            display_name: "Person".into(),
            ..Default::default()
        })?;
        let text = tx.create_text(" after words")?;
        tx.append(p, &[mention.key(), text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
        Ok((p.key(), text.key()))
    })?;
    Ok((editor, paragraph, text))
}
fn command(start: bool, shift: bool, apple: bool) -> Command {
    Command::Key {
        command: if start {
            KeyCommand::MoveToStart
        } else {
            KeyCommand::MoveToEnd
        },
        event: Some(KeyEvent {
            key: if start {
                "ArrowLeft".into()
            } else {
                "ArrowRight".into()
            },
            ctrl: !apple,
            meta: apple,
            shift,
            ..Default::default()
        }),
    }
}
fn span(anchor: Point, focus: Point) -> RangeSelection {
    let mut range = RangeSelection::collapsed(anchor);
    range.focus = focus;
    range
}
fn range(editor: &Editor) -> &RangeSelection {
    editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("actual range")
}

#[test]
fn start_boundary_and_shift_match_source_on_every_non_apple_engine() -> Result<(), Error> {
    for engine in [ViewEngine::Chromium, ViewEngine::Firefox] {
        for shift in [false, true] {
            let (mut editor, block, text) = fixture(ViewHost {
                engine,
                os: ViewOs::Other,
            })?;
            let before = editor.state().to_json()?;
            let (handled, commit) = editor.dispatch(&command(true, shift, false))?;
            assert_eq!(handled, Handled::Yes);
            assert!(commit.default_prevented);
            assert_eq!(range(&editor).focus, Point::element(block, ChildIndex(0)));
            assert_eq!(
                range(&editor).anchor,
                if shift {
                    Point::text(text, Utf16Offset(0))
                } else {
                    Point::element(block, ChildIndex(0))
                }
            );
            assert_eq!(editor.state().to_json()?, before);
        }
    }
    Ok(())
}

#[test]
fn start_away_and_expanded_consume_without_preventing_or_mutating_word_motion() -> Result<(), Error>
{
    let (mut editor, block, text) = fixture(ViewHost::HEADLESS)?;
    for selection in [
        RangeSelection::collapsed(Point::text(text, Utf16Offset(6))),
        span(
            Point::text(text, Utf16Offset(1)),
            Point::text(text, Utf16Offset(6)),
        ),
        RangeSelection::collapsed(Point::element(block, ChildIndex(0))),
    ] {
        editor.update(|tx| tx.set_selection(Some(Selection::Range(selection.clone()))))?;
        let (handled, commit) = editor.dispatch(&command(true, true, false))?;
        assert_eq!(handled, Handled::Yes);
        assert!(!commit.default_prevented);
        assert_eq!(range(&editor), &selection);
    }
    Ok(())
}

#[test]
fn end_element_zero_consumes_without_prevention_or_selection_change() -> Result<(), Error> {
    let (mut editor, block, text) = fixture(ViewHost::HEADLESS)?;
    for selection in [
        RangeSelection::collapsed(Point::element(block, ChildIndex(0))),
        span(
            Point::element(block, ChildIndex(0)),
            Point::text(text, Utf16Offset(6)),
        ),
    ] {
        editor.update(|tx| tx.set_selection(Some(Selection::Range(selection.clone()))))?;
        let (handled, commit) = editor.dispatch(&command(false, true, false))?;
        assert_eq!(handled, Handled::Yes);
        assert!(!commit.default_prevented);
        assert_eq!(range(&editor), &selection);
    }
    for point in [
        Point::text(text, Utf16Offset(0)),
        Point::element(block, ChildIndex(1)),
    ] {
        editor.update(|tx| {
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))
        })?;
        let (handled, commit) = editor.dispatch(&command(false, false, false))?;
        assert_eq!(handled, Handled::No);
        assert!(!commit.default_prevented);
        assert_eq!(range(&editor).anchor, point);
    }
    Ok(())
}

#[test]
fn apple_and_ios_leave_both_commands_to_the_lower_rich_text_handler() -> Result<(), Error> {
    for os in [ViewOs::Apple, ViewOs::Ios] {
        for start in [true, false] {
            let (mut editor, block, text) = fixture(ViewHost {
                engine: ViewEngine::AppleWebKit,
                os,
            })?;
            let point = if start {
                Point::text(text, Utf16Offset(0))
            } else {
                Point::element(block, ChildIndex(0))
            };
            editor.update(|tx| {
                tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(point))))
            })?;
            let (handled, commit) = editor.dispatch(&command(start, false, true))?;
            assert_eq!(handled, Handled::No);
            assert!(!commit.default_prevented);
            assert_eq!(range(&editor).anchor, point);
        }
    }
    Ok(())
}

#[test]
fn either_endpoint_inside_either_code_class_declines_the_interception() -> Result<(), Error> {
    for custom in [false, true] {
        let (mut editor, block, text) = fixture(ViewHost::HEADLESS)?;
        let (code_text, _) = editor.update(|tx| {
            let code = if custom {
                tx.create(CustomCodeNode::default())?.key()
            } else {
                tx.create(CodeNode::default())?.key()
            };
            let value = tx.create_text("code")?;
            tx.append(code, &[value.key()])?;
            tx.append(NodeKey::ROOT, &[code])?;
            Ok(value.key())
        })?;
        for (start, selection) in [
            (
                true,
                span(
                    Point::text(code_text, Utf16Offset(0)),
                    Point::text(text, Utf16Offset(0)),
                ),
            ),
            (
                false,
                span(
                    Point::element(block, ChildIndex(0)),
                    Point::text(code_text, Utf16Offset(0)),
                ),
            ),
        ] {
            editor.update(|tx| tx.set_selection(Some(Selection::Range(selection.clone()))))?;
            let (handled, commit) = editor.dispatch(&command(start, false, false))?;
            assert_eq!(handled, Handled::No);
            assert!(!commit.default_prevented);
            assert_eq!(range(&editor), &selection);
        }
    }
    Ok(())
}

#[test]
fn absent_node_and_ordinary_text_selections_do_not_claim_word_commands() -> Result<(), Error> {
    let (mut editor, block, _) = fixture(ViewHost::HEADLESS)?;
    let (plain, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let value = tx.create_text("ordinary")?;
        tx.append(p, &[value.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(value.key())
    })?;
    let mut nodes = NodeSelection::new();
    nodes.add(
        editor
            .state()
            .view()
            .first_child(block)
            .expect("actual mention"),
    );
    for selection in [
        None,
        Some(Selection::Node(nodes)),
        Some(Selection::Range(RangeSelection::collapsed(Point::text(
            plain,
            Utf16Offset(0),
        )))),
    ] {
        editor.update(|tx| tx.set_selection(selection.clone()))?;
        for start in [true, false] {
            let (handled, commit) = editor.dispatch(&command(start, false, false))?;
            assert_eq!(handled, Handled::No);
            assert!(!commit.default_prevented);
            assert_eq!(editor.state().selection(), selection.as_ref());
        }
    }
    Ok(())
}

#[test]
fn named_decode_requires_real_matching_keyboard_facts_and_exact_null_payload() -> Result<(), Error>
{
    let valid = KeyEvent {
        key: "ArrowLeft".into(),
        ctrl: true,
        ..Default::default()
    };
    assert!(decode(START, "null", Some(&valid))?.is_some());
    assert!(decode(START, "null", None).is_err());
    assert!(decode(START, "{}", Some(&valid)).is_err());
    for invalid in [
        KeyEvent {
            key: "ArrowRight".into(),
            ..valid.clone()
        },
        KeyEvent {
            ctrl: false,
            ..valid.clone()
        },
        KeyEvent {
            meta: true,
            ..valid.clone()
        },
        KeyEvent {
            alt: true,
            ..valid.clone()
        },
        KeyEvent {
            is_composing: true,
            ..valid.clone()
        },
    ] {
        assert!(decode(START, "null", Some(&invalid)).is_err());
    }
    assert!(decode("unknown", "invalid", None)?.is_none());
    assert_eq!(key_prevents_default(START), Some(false));
    assert_eq!(key_prevents_default(END), Some(false));
    Ok(())
}

#[derive(Clone)]
struct GenericProbe {
    stop: bool,
    calls: Arc<Mutex<Vec<&'static str>>>,
}
impl Plugin for GenericProbe {
    fn name(&self) -> &'static str {
        "word-generic-order-control"
    }
    fn commands(&self) -> &[CommandRegistration] {
        const COMMANDS: &[CommandRegistration] = &[CommandRegistration {
            command: CommandKind::KeyDown,
            priority: CommandPriority::Low,
            placement: Placement::After,
        }];
        COMMANDS
    }
    fn handle(&self, _: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        if !matches!(command, Command::KeyDown(_)) {
            return Ok(Handled::No);
        }
        self.calls.lock().expect("probe lock").push("generic-low");
        Ok(if self.stop { Handled::Yes } else { Handled::No })
    }
}
#[test]
fn real_generic_keydown_runs_before_high_word_interception_and_can_stop_it() -> Result<(), Error> {
    for stop in [false, true] {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let mut editor = register(
            Editor::builder(EditorMode::ViewAttached)
                .node::<UserMentionNode>()
                .plugin(GenericProbe {
                    stop,
                    calls: calls.clone(),
                }),
        )
        .build()
        .expect("word chronology builder");
        let ((block, text), _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let d = tx.create(UserMentionNode::default())?;
            let t = tx.create_text(" after words")?;
            tx.append(p, &[d.key(), t.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.text(t)?
                .select(Some(Utf16Offset(0)), Some(Utf16Offset(0)))?;
            Ok((p.key(), t.key()))
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
        let Command::Key {
            event: Some(event), ..
        } = command(true, false, false)
        else {
            panic!("word event");
        };
        let out = core
            .apply(
                Input::KeyDown {
                    event: event.clone(),
                    routed: Some(command(true, false, false)),
                    routed_prevent_default: false,
                    selection: ViewSelection::KeepModel,
                },
                HistoryTime(1),
            )
            .map_err(|failure| failure.error)?;
        assert_eq!(*calls.lock().expect("probe lock"), ["generic-low"]);
        let current = core
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("actual core range");
        assert_eq!(
            current.anchor,
            if stop {
                Point::text(text, Utf16Offset(0))
            } else {
                Point::element(block, ChildIndex(0))
            }
        );
        assert_eq!(out.effects.contains(&Effect::PreventDefault), !stop);
    }
    Ok(())
}
