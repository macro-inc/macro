use super::*;
#[derive(Clone, Debug, PartialEq)]
struct Counter(u32);
static COMMAND: CommandKey<u32> = CommandKey::new("count");
static OTHER: CommandKey<u32> = CommandKey::new("count");
static EVENT: EventKey<u32> = EventKey::new("count");
static OTHER_EVENT: EventKey<u32> = EventKey::new("count");
#[test]
fn extension_state_rolls_back_and_history_does_not_restore_it() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Counter(0))
        .build()
        .unwrap();
    assert!(editor.try_extension::<String>().is_none());
    assert_eq!(
        editor.extension::<String>().unwrap_err().kind(),
        "UnknownExtensionState"
    );
    assert!(
        editor
            .update(|tx| {
                tx.extension_mut::<Counter>()?.0 = 10;
                assert!(tx.try_extension::<String>().is_none());
                Err::<(), _>(Error::Invariant("abort"))
            })
            .is_err()
    );
    assert_eq!(editor.extension::<Counter>().unwrap(), &Counter(0));
    let (_, first) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[p.key()])
        })
        .unwrap();
    let before = first.next.clone();
    editor
        .update(|tx| {
            tx.extension_mut::<Counter>()?.0 = 2;
            assert_eq!(tx.extension::<Counter>()?, &Counter(2));
            Ok(())
        })
        .unwrap();
    editor.set_editor_state(before, TagSet::default()).unwrap();
    assert_eq!(editor.extension::<Counter>().unwrap(), &Counter(2));
    assert!(
        Editor::builder(EditorMode::Headless)
            .extension_state(Counter(1))
            .extension_state(Counter(2))
            .build()
            .is_err()
    );
}
#[test]
fn command_and_event_identity_use_static_keys_and_shared_payloads() {
    let command = ExtensionCommand::new(&COMMAND, 7);
    assert_eq!(COMMAND.name(), "count");
    assert_eq!(command.payload(&COMMAND), Some(&7));
    assert_eq!(command.payload(&OTHER), None);
    assert_eq!(command, command.clone());
    assert_ne!(command, ExtensionCommand::new(&COMMAND, 7));
    assert_eq!(
        Command::Extension(command).kind(),
        CommandKind::Extension(&COMMAND)
    );
    assert_ne!(
        CommandKind::Extension(&COMMAND),
        CommandKind::Extension(&OTHER)
    );
    assert_ne!(
        CommandKind::Key(KeyCommand::Enter),
        CommandKind::Key(KeyCommand::Tab)
    );
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    assert!(
        editor
            .update(|tx| {
                tx.emit(&EVENT, 1);
                Err::<(), _>(Error::Invariant("abort"))
            })
            .is_err()
    );
    let (_, commit) = editor
        .update(|tx| {
            tx.emit(&EVENT, 2);
            tx.emit(&EVENT, 3);
            Ok(())
        })
        .unwrap();
    assert_eq!(EVENT.name(), "count");
    assert_eq!(
        commit.events_of(&EVENT).copied().collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert_eq!(commit.events[0].payload(&OTHER_EVENT), None);
    assert_eq!(commit.events[0], commit.events[0].clone());
    assert_ne!(commit.events[0], commit.events[1]);
    let clipboard = ClipboardPayload {
        data: [("text/plain".into(), "paste".into())]
            .into_iter()
            .collect(),
        has_files: false,
        html_nodes: None,
    };
    assert_eq!(clipboard.get("text/plain"), Some("paste"));
    assert_eq!(clipboard.get("text/html"), None);
}
