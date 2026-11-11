use super::*;
use serde_json::json;

fn plans_in_packet(packet: &[u8]) -> Result<Vec<serde_json::Value>, BoundaryError> {
    let word = |at: usize| u32::from_le_bytes(packet[at..at + 4].try_into().expect("word"));
    assert_eq!(word(0), 0x4d534553);
    let mut at = (24 + word(12) as usize * 4 + word(16) as usize + 3) & !3;
    let mut plans = Vec::new();
    for _ in 0..word(20) {
        let tag = word(at);
        let length = word(at + 12) as usize;
        let start = at + 16;
        if tag == 16 {
            let effect = wire::ViewEffectMsg::deserialize(&packet[start..start + length])?;
            if effect.kind == 6 && effect.code == 9 {
                assert_eq!(effect.text, "group-b.checklist-plan-updates");
                plans.push(serde_json::from_str(&effect.style)?);
            }
        }
        at = (start + length + 3) & !3;
    }
    assert_eq!(at, packet.len());
    Ok(plans)
}

#[test]
fn checklist_output_transfer_retry_reject_text_and_remount_keep_exact_receipts(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "checklist-transfer-fixture".into(),
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
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    machine.editor(Input::SetState {
        state: serde_json::from_value(json!({"root":{"type":"root","children":[{"type":"list","listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","value":1,"checked":false,"children":[{"type":"text","text":"Work"}]}]}]}})).expect("state"),
        tags: TagSet::default(),
    }, 2.0)?;
    machine.take_output()?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    let generation = session.surface().state().max_key().generation();
    let mut payload: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))?;
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    let command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("command");
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        3.0,
    )?;
    assert_eq!(machine.pending_checklist_output.len(), 1);
    let first = serde_json::to_value(&machine.pending_checklist_output)?;
    let retained_bytes = machine.output.clone();
    assert_eq!(
        serde_json::to_value(plans_in_packet(&retained_bytes)?)?,
        first
    );
    assert!(matches!(
        machine.initialize_view(),
        Err(BoundaryError::Invalid(
            "initialize before pending output transfer"
        ))
    ));
    assert_eq!(machine.output, retained_bytes);
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?,
        first
    );
    // Real encoder failure injection: incompatible actual diff generations.
    // No fake transport success or synthetic acknowledgement is used.
    let output = SessionOutput {
        view: vec![
            ViewEffect::ChecklistPlans(machine.pending_checklist_output[0].clone()),
            ViewEffect::Diff(Diff {
                generation,
                full_reconcile: false,
                view_text_matches: None,
                ops: vec![],
                decorator_renders: vec![],
            }),
            ViewEffect::Diff(Diff {
                generation: generation + 1,
                full_reconcile: false,
                view_text_matches: None,
                ops: vec![],
                decorator_renders: vec![],
            }),
        ],
        ..Default::default()
    };
    let mut rejected_bytes = vec![];
    assert!(matches!(
        output::encode_observed(
            &output,
            false,
            &mut rejected_bytes,
            None,
            None,
            &mut machine.decorator_observer
        ),
        Err(BoundaryError::Invalid("diff generation"))
    ));
    assert_eq!(machine.output, retained_bytes);
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?,
        first
    );
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        4.0,
    )?;
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?,
        first
    );
    // The error/correction packet carries no checklist receipt and cannot ACK it.
    machine.reject_text("invalid DOM text input")?;
    assert!(machine.pending_checklist_output.is_empty());
    let correction = machine.take_output()?;
    assert!(plans_in_packet(&correction)?.is_empty());
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        5.0,
    )?;
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?,
        first
    );
    assert!(!machine.take_output()?.is_empty());
    assert!(machine.take_output()?.is_empty());
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        6.0,
    )?;
    assert!(
        machine.pending_checklist_output.is_empty(),
        "actual successful transfer acknowledged revision one"
    );
    machine.take_output()?;
    let reset_packet = machine.initialize_view()?;
    let reset = plans_in_packet(&reset_packet)?;
    assert_eq!(reset.len(), 1);
    assert_eq!(reset[0]["sequence"], "2");
    assert_eq!(reset[0]["reset"], true);
    assert_eq!(reset[0]["lists"].as_array().expect("lists").len(), 1);
    machine.editor(
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        7.0,
    )?;
    assert!(
        machine.pending_checklist_output.is_empty(),
        "initialize exposed its full reset"
    );
    machine.take_output()?;
    payload["rebind"] = json!(true);
    let command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("command");
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        8.0,
    )?;
    let rebound = serde_json::to_value(&machine.pending_checklist_output)?;
    assert_eq!(
        serde_json::to_value(plans_in_packet(&machine.output)?)?,
        rebound
    );
    assert_eq!(rebound[0]["reset"], true);
    assert_eq!(rebound[0]["sequence"], "3");
    assert_eq!(rebound[0]["lists"].as_array().expect("lists").len(), 1);
    machine.editor(
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        9.0,
    )?;
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?,
        rebound,
        "unknown transfer retry keeps its exact sequence"
    );
    machine.take_output()?;
    Ok(())
}
