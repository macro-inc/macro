use super::*;

#[test]
fn remote_cursor_points_follow_local_crdt_edits_and_expire() {
    let (_, snapshot) = editor_seed();
    let mut session = session_editor(Access::Edit, TransportKind::Direct, snapshot);
    connect(&mut session);
    let key = text_key(&session);
    session.handle(
        time(4),
        SessionInput::Editor(Input::SelectionFromView {
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(3)),
                focus: Point::text(key, Utf16Offset(3)),
                resolution_dirty: false,
            },
            change: None,
        }),
    );
    let cursors = session.surface().selection_cursors().unwrap();
    let mut presence = ProtocolPresence::new(WallDuration(10000));
    presence
        .set(
            "60",
            loro::LoroValue::Map(
                vec![
                    ("selection".into(), lexical_loro::encode_selection(&cursors)),
                    (
                        "user".into(),
                        loro::LoroValue::Map(
                            vec![("color".into(), loro::LoroValue::from("blue"))].into(),
                        ),
                    ),
                ]
                .into(),
            ),
            time(5).wall,
        )
        .unwrap();
    let bytes = presence.encode("60", time(5).wall).unwrap();
    wire(
        &mut session,
        sync_protocol::FromRemote::RemoteAwareness {
            awareness: bebop::SliceWrapper::from_cooked(&bytes),
        },
        5,
    );
    let expected = ViewSelection::Range {
        anchor: Point::text(key, Utf16Offset(3)),
        focus: Point::text(key, Utf16Offset(3)),
        resolution_dirty: false,
    };
    assert!(
        session
            .last_output()
            .view
            .iter()
            .any(|effect| match effect {
                ViewEffect::Cursors(peers) =>
                    peers.len() == 1
                        && peers[0].key == "60"
                        && peers[0].color == "blue"
                        && peers[0].selection == expected,
                _ => false,
            })
    );
    let out = session.handle(
        time(6),
        SessionInput::Editor(Input::Command {
            command: Command::InsertText("遠".into()),
            selection: ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(0)),
                focus: Point::text(key, Utf16Offset(0)),
                resolution_dirty: false,
            },
        }),
    );
    let expected = ViewSelection::Range {
        anchor: Point::text(key, Utf16Offset(4)),
        focus: Point::text(key, Utf16Offset(4)),
        resolution_dirty: false,
    };
    assert!(out.view.iter().any(|effect| match effect {
        ViewEffect::Cursors(peers) => peers.len() == 1 && peers[0].selection == expected,
        _ => false,
    }));
    let out = session.handle(time(10006), SessionInput::Sync(SyncInput::Tick));
    assert!(
        out.view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Cursors(peers) if peers.is_empty()))
    );
}
