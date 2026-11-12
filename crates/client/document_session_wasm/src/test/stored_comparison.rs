use super::*;

#[test]
fn stored_comparison_query_is_opt_in_and_preserves_pending_output(
) -> Result<(), Box<dyn std::error::Error>> {
    let config = wire::SessionConfigMsg {
        doc: "stored-comparison-fixture".into(),
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
    let doc = lexical_loro::new_doc(91)?;
    doc.import(lexical_loro::golden::MARKDOWN_GOLDEN)?;
    let initial =
        lexical_loro::reconstruct_state(&doc, &macro_document_model::sync::MACRO_SYNC_POLICY)?;
    let mut raw = serde_json::to_value(initial)?;
    raw["root"]["$"]["documentMetadata"] = serde_json::json!({"version":10});
    let snapshot = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &raw,
        Some(lexical_loro::golden::MARKDOWN_GOLDEN),
    )?;
    let mut machine =
        machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot,
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
    let output = session.machine.output.clone();
    assert!(!output.is_empty());
    let generation = session.machine.generation();
    let reply = query::query(
        &session,
        wire::QueryMsg {
            kind: 10,
            key: 0,
            text: String::new(),
            flags: 0,
        },
    );
    #[cfg(feature = "dev-probes")]
    {
        let reply = reply?;
        let value: serde_json::Value = serde_json::from_str(&reply.text)?;
        assert_eq!(
            reply.text,
            serde_json::to_string(&session.surface().stored_comparison()?)?
        );
        assert_eq!(
            reply.text,
            serde_json::to_string(&lexical_loro::stored_comparison(
                session.surface().state(),
                &macro_document_model::sync::MACRO_SYNC_POLICY
            )?)?
        );
        assert_eq!(
            value["root"]["$"]["documentMetadata"],
            serde_json::json!({"version":10})
        );
        assert_eq!(
            before.root["$"]["documentMetadata"],
            serde_json::json!({"version":10,"environmentTags":null})
        );
        for (key, text, flags) in [(1, "", 0), (0, "payload", 0), (0, "", 1)] {
            assert!(matches!(
                query::query(
                    &session,
                    wire::QueryMsg {
                        kind: 10,
                        key,
                        text: text.into(),
                        flags
                    }
                ),
                Err(BoundaryError::Invalid("stored comparison query fields"))
            ));
        }
        assert_eq!(reply.count, 0);
        assert!(reply.keys.is_empty() && reply.nodes.is_empty() && reply.points.is_empty());
    }
    #[cfg(not(feature = "dev-probes"))]
    {
        assert!(matches!(reply, Err(BoundaryError::Invalid("query kind"))));
        for (key, text, flags) in [(1, "", 0), (0, "payload", 0), (0, "", 1)] {
            assert!(matches!(
                query::query(
                    &session,
                    wire::QueryMsg {
                        kind: 10,
                        key,
                        text: text.into(),
                        flags
                    }
                ),
                Err(BoundaryError::Invalid("query kind"))
            ));
        }
    }
    assert_eq!(session.machine.output, output);
    assert_eq!(session.machine.generation(), generation);
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}
