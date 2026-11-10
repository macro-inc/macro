use super::*;

#[test]
fn effective_access_wire_getter_tracks_mid_session_authorization_without_consuming_output() {
    let config = wire::SessionConfigMsg {
        doc: "effective-access-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut editor =
        EditorSession::create(generated::ABI_MAJOR, &bytes(&config).unwrap(), 0.0, 0.0).unwrap();
    editor.machine.sync(SyncInput::Start, 0.0, None).unwrap();
    editor
        .machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )
        .unwrap();
    assert_eq!(editor.effective_access(), u8::from(wire::Access::Edit));
    for (at, write, comment, expected) in [
        (2.0, false, true, wire::Access::CommentOnly),
        (3.0, false, false, wire::Access::Read),
        (4.0, true, true, wire::Access::Edit),
    ] {
        editor.authorization(true, write, comment, at, at).unwrap();
        let output = editor.machine.output.clone();
        let wake = editor.machine.wake;
        assert_eq!(editor.effective_access(), u8::from(expected));
        assert_eq!(editor.effective_access(), u8::from(expected));
        assert_eq!(editor.machine.output, output);
        assert_eq!(editor.machine.wake, wake);
    }
}
