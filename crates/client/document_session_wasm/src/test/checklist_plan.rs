use super::*;

#[test]
fn checklist_plan_query_uses_current_generation_and_actual_list_state() -> Result<(), BoundaryError>
{
    let config = wire::SessionConfigMsg {
        doc: "checklist-query".into(),
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
    machine.editor(Input::SetState {state:serde_json::from_value(serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"list","listType":"check","tag":"ul","start":1,"version":1,"children":[{"type":"listitem","value":1,"checked":true,"version":1,"children":[{"type":"text","version":1,"text":"Work!"}]}]}]}}))?,tags:TagSet::default()},2.0)?;
    let machine::Session::Editor(native) = &machine.session else {
        panic!("editor")
    };
    let list = native
        .surface()
        .state()
        .view()
        .first_child(NodeKey::ROOT)
        .expect("list");
    let before = native.surface().state().to_json()?;
    let mut data: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))?;
    data["listKey"] = serde_json::json!(list.index());
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
        text: serde_json::json!({"name":"group-b.checklist-plan","data":data}).to_string(),
    };
    let reply = query::query(&session, request.clone())?;
    let result: serde_json::Value = serde_json::from_str(&reply.text)?;
    assert_eq!(result["kind"], "planned");
    assert_eq!(result["progress"]["done"], 1);
    assert_eq!(result["items"][0]["text"], "Work!");
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
