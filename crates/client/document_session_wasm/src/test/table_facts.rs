use super::*;

#[test]
fn table_facts_query_uses_the_shared_bulk_dto_under_read_and_current_generation(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "table-facts-query".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
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
    let mut machine =
        machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: lexical_loro::golden::MARKDOWN_GOLDEN.to_vec(),
        },
        1.0,
        None,
    )?;
    machine.editor(Input::SetState {
        state:serde_json::from_value(serde_json::json!({"root":{"type":"root","children":[{"type":"table","colWidths":[80,140],"children":[{"type":"tablerow","children":[
            {"type":"tablecell","headerState":1,"children":[{"type":"paragraph","children":[{"type":"text","text":"A"}]}]},
            {"type":"tablecell","children":[{"type":"paragraph","children":[{"type":"text","text":"B"}]}]}
        ]}]}]}}))?, tags:TagSet::default()
    },2.0)?;
    let machine::Session::Editor(native) = &machine.session else {
        panic!("editor")
    };
    let table = native
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("table");
    let before = native.surface().state().to_json()?;
    let data = serde_json::json!({"keys":[table.index()]});
    machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }),
        3.0,
        Some(3.0),
    )?;
    let session = EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
    };
    let request = wire::QueryMsg {
        kind: 9,
        key: 0,
        flags: session.machine.generation(),
        text: serde_json::json!({"name":"group-b.table-facts","data":data}).to_string(),
    };
    let reply = query::query(&session, request.clone())?;
    let result: serde_json::Value = serde_json::from_str(&reply.text)?;
    assert_eq!(result["tables"][0]["columnCount"], 2);
    assert_eq!(
        result["tables"][0]["colWidths"],
        serde_json::json!({"kind":"value","value":[80,140]})
    );
    assert_eq!(result["tables"][0]["cells"][0]["headerState"], 1);
    assert_eq!(
        result["tables"][0]["cells"]
            .as_array()
            .expect("cells")
            .len(),
        2
    );
    assert_eq!(session.surface().state().to_json()?, before);
    let mut stale = request;
    stale.flags += 1;
    stale.text = "invalid JSON".into();
    assert!(matches!(
        query::query(&session, stale),
        Err(BoundaryError::Invalid("application query generation"))
    ));
    Ok(())
}
