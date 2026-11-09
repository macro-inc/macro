use crate::*;
use doc_sync_core::*;
use lexical_model::*;

#[test]
fn raw_string_and_cold_query_share_canonical_bytes_without_mutating_state(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "raw-export".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: true,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine =
        machine::Machine::create(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0, true)?;
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    machine.editor(
        Input::SetState {
            state: serde_json::from_value(serde_json::json!({"root":{
                "children":[{"children":[{
                    "detail":0,"format":0,"mode":"normal","style":"","text":"line\n😀",
                    "type":"text","version":1,"$":{"id":"text"}
                }],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,
                "$":{"id":"paragraph"},"textFormat":0,"textStyle":""}],
                "direction":null,"format":"","indent":0,"type":"root","version":1,
                "$":{"0":-0.0,"id":"root"}
            }}))?,
            tags: TagSet::default(),
        },
        2.0,
    )?;
    let session = EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
    };
    let before = session.surface().state().to_json()?;
    let expected = r#"{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"line\n😀","type":"text","version":1,"$":{"id":"text"}}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"$":{"id":"paragraph"},"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1,"$":{"0":0,"id":"root"}}}"#;
    assert_eq!(
        session.serialized_state().expect("raw serialization"),
        expected
    );
    let reply = session
        .query(&bytes(&wire::QueryMsg {
            kind: 7,
            key: 0,
            text: String::new(),
            flags: 0,
        })?)
        .expect("raw cold query");
    let reply = wire::QueryReplyMsg::deserialize(&reply)?;
    assert_eq!(reply.text, expected);
    assert_eq!(reply.count, 0);
    assert!(reply.keys.is_empty());
    assert!(reply.nodes.is_empty());
    assert!(reply.points.is_empty());
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}
