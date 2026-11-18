use super::*;

#[test]
fn action_dependencies_use_the_actual_readonly_registry_and_query_generation(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "action-dependencies-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
        access: wire::Access::Read,
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
    let session = EditorSession {
        #[cfg(feature = "compatibility")]
        compatibility: None,
        machine,
        hostname: None,
        code_tokens: None,
    };
    let before = session.surface().state().to_json()?;
    for (types, available) in [
        (serde_json::json!([]), true),
        (serde_json::json!(["custom-code", "horizontalrule"]), true),
        (serde_json::json!(["not-registered"]), false),
    ] {
        let request = wire::QueryMsg {
            kind: 9,
            key: 0,
            flags: session.machine.generation(),
            text: serde_json::json!({
                "name":"group-a.action-dependencies", "data":{"types":types}
            })
            .to_string(),
        };
        let reply = query::query(&session, request)?;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&reply.text)?,
            serde_json::json!({"available":available})
        );
    }
    let invalid = wire::QueryMsg {
        kind: 9,
        key: 0,
        flags: session.machine.generation(),
        text: serde_json::json!({
            "name":"group-a.action-dependencies", "data":{"types":[null],"extra":true}
        })
        .to_string(),
    };
    let mut stale = invalid.clone();
    stale.flags += 1;
    assert!(matches!(
        query::query(&session, stale),
        Err(BoundaryError::Invalid("application query generation"))
    ));
    assert!(query::query(&session, invalid).is_err());
    for data in [
        serde_json::json!([]),
        serde_json::json!([[]]),
        serde_json::json!(null),
    ] {
        let request = wire::QueryMsg {
            kind: 9,
            key: 0,
            flags: session.machine.generation(),
            text: serde_json::json!({"name":"group-a.action-dependencies", "data":data})
                .to_string(),
        };
        assert!(query::query(&session, request).is_err());
    }
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}
