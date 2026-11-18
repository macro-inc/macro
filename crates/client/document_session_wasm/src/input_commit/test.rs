use super::*;
use doc_sync_core::{SeedKind, SyncInput};
use lexical_model::{CommitId, Input, TagSet};
mod inventory;

#[test]
fn canonical_ids_reject_without_replacing_the_previous_completed_receipt() {
    let mut ledger = InputCommitLedger::default();
    let entry = ledger.begin("7").expect("entry");
    ledger
        .finish(
            entry,
            MainCommitOutcome::Published {
                commit_id: CommitId(0),
                handled: Handled::Yes,
            },
        )
        .expect("complete");
    for invalid in [
        "",
        "0",
        "00",
        "01",
        "+8",
        "-8",
        " 8",
        "8 ",
        "8e0",
        "8.0",
        "８",
        "7",
        "6",
        "18446744073709551616",
    ] {
        assert!(ledger.begin(invalid).is_err(), "{invalid:?}");
        let receipt = ledger.read("7").expect("previous receipt retained");
        assert_eq!(receipt.entry_id(), 7);
        assert_eq!(receipt.main_kind(), InputCommitKind::Published);
        assert_eq!(receipt.commit_id(), Some(0));
        assert_eq!(receipt.main_handled(), Some(true));
    }
    let entry = ledger
        .begin("18446744073709551615")
        .expect("full u64 maximum");
    ledger
        .finish(entry, MainCommitOutcome::NotPublished)
        .expect("complete");
    let receipt = ledger.read("18446744073709551615").expect("max receipt");
    assert_eq!(receipt.entry_id(), u64::MAX);
    assert_eq!(receipt.commit_id(), None);
    assert_eq!(receipt.main_handled(), None);
}
#[test]
fn in_flight_stale_and_invalidated_slots_never_report_not_published() {
    let mut ledger = InputCommitLedger::default();
    let first = ledger.begin("1").expect("entry");
    assert!(ledger.read("1").is_err());
    ledger
        .finish(first, MainCommitOutcome::NotPublished)
        .expect("complete");
    assert_eq!(
        ledger.read("1").expect("completed").main_kind(),
        InputCommitKind::NotPublished
    );
    let second = ledger.begin("2").expect("next");
    assert!(ledger.read("1").is_err());
    assert!(ledger.read("2").is_err());
    ledger.invalidate();
    assert!(ledger.read("2").is_err());
    assert!(ledger.begin("1").is_err());
    assert!(ledger.begin("2").is_err());
    assert!(ledger
        .finish(second, MainCommitOutcome::NotPublished)
        .is_err());
    assert!(ledger.read("2").is_err());
}
fn machine() -> machine::Machine {
    let config = wire::SessionConfigMsg {
        doc: "main-commit-fixture".into(),
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
    let mut machine = machine::Machine::create_macro(
        generated::ABI_MAJOR,
        &bytes(&config).expect("config"),
        0.0,
        0.0,
    )
    .expect("machine");
    machine.sync(SyncInput::Start, 0.0, None).expect("start");
    machine
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )
        .expect("seed");
    machine.take_output().expect("initial output");
    machine
}
fn application(machine: &machine::Machine, name: &str, json: &str) -> wire::SessionInputMsg {
    wire::SessionInputMsg {
        kind: 2,
        request: 0,
        code: 0,
        flag: false,
        bytes: vec![],
        peers: vec![],
        operations: vec![],
        mark_id: String::new(),
        anchor: vec![],
        focus: vec![],
        expected_text: String::new(),
        editor: wire::EditorInputMsg::EditorApplication {
            name: name.into(),
            json: json.into(),
            generation: machine.generation(),
            selection: editor_input::empty_selection(),
            keyboard: false,
            key: String::new(),
            mods: 0,
            code: 0,
        },
    }
}
#[test]
fn actual_application_noop_is_published_and_receipt_reads_never_consume_output() {
    let mut machine = machine();
    let msg = bytes(&application(
        &machine,
        "group-b.equation",
        r#"{"key":0,"equation":"x"}"#,
    ))
    .expect("input");
    machine
        .input_observed(&msg, 2.0, 2.0, "1")
        .expect("actual main");
    let output = machine.output.clone();
    for _ in 0..2 {
        let receipt = machine.input_commits.read("1").expect("receipt");
        assert_eq!(receipt.main_kind(), InputCommitKind::Published);
        assert_eq!(receipt.main_handled(), Some(false));
        assert!(receipt.commit_id().is_some());
        assert_eq!(machine.output, output);
    }
    machine.take_output().expect("consume output");
    assert_eq!(
        machine
            .input_commits
            .read("1")
            .expect("receipt after output")
            .main_kind(),
        InputCommitKind::Published
    );
    machine.initialize_view().expect("cold view output");
    assert_eq!(
        machine
            .input_commits
            .read("1")
            .expect("receipt after initialize")
            .main_kind(),
        InputCommitKind::Published
    );
}
#[test]
fn malformed_family_generation_and_authority_refusal_have_exact_native_not_published_receipts() {
    let mut machine = machine();
    assert!(machine.input_observed(&[], 2.0, 2.0, "1").is_err());
    assert_eq!(
        machine
            .input_commits
            .read("1")
            .expect("decode receipt")
            .main_kind(),
        InputCommitKind::NotPublished
    );
    let mut wrong = application(&machine, "group-b.equation", r#"{"key":0,"equation":"x"}"#);
    if let wire::EditorInputMsg::EditorApplication { keyboard, .. } = &mut wrong.editor {
        *keyboard = true;
    }
    assert!(machine
        .input_observed(&bytes(&wrong).expect("input"), 3.0, 3.0, "2")
        .is_err());
    assert_eq!(
        machine
            .input_commits
            .read("2")
            .expect("family receipt")
            .main_kind(),
        InputCommitKind::NotPublished
    );
    let mut stale = application(&machine, "group-b.equation", r#"{"key":0,"equation":"x"}"#);
    if let wire::EditorInputMsg::EditorApplication { generation, .. } = &mut stale.editor {
        *generation += 1;
    }
    assert!(machine
        .input_observed(&bytes(&stale).expect("input"), 4.0, 4.0, "3")
        .is_err());
    assert_eq!(
        machine
            .input_commits
            .read("3")
            .expect("generation receipt")
            .main_kind(),
        InputCommitKind::NotPublished
    );
    machine
        .sync(
            SyncInput::Authorization(doc_sync_core::AuthorizationState {
                current: true,
                can_write: false,
                can_comment: false,
            }),
            5.0,
            None,
        )
        .expect("revoke");
    let msg = bytes(&application(
        &machine,
        "group-b.equation",
        r#"{"key":0,"equation":"x"}"#,
    ))
    .expect("input");
    machine
        .input_observed(&msg, 6.0, 6.0, "4")
        .expect("ordinary native refusal flags");
    let receipt = machine.input_commits.read("4").expect("authority receipt");
    assert_eq!(receipt.main_kind(), InputCommitKind::NotPublished);
    assert_eq!(receipt.main_handled(), None);
}
#[test]
fn ordinary_mutation_and_failed_decode_invalidate_receipts_without_reusing_ids() {
    let mut machine = machine();
    let msg = bytes(&application(
        &machine,
        "group-b.equation",
        r#"{"key":0,"equation":"x"}"#,
    ))
    .expect("input");
    machine.input_observed(&msg, 2.0, 2.0, "1").expect("main");
    assert!(machine.input(&[], 3.0, 3.0).is_err());
    assert!(machine.input_commits.read("1").is_err());
    assert!(machine.input_observed(&msg, 4.0, 4.0, "1").is_err());
    machine
        .input_observed(&msg, 5.0, 5.0, "2")
        .expect("fresh entry");
    machine
        .editor(
            Input::SetState {
                state: serde_json::from_value(
                    serde_json::json!({"root":{"type":"root","children":[]}}),
                )
                .expect("state"),
                tags: TagSet::default(),
            },
            6.0,
        )
        .expect("ordinary input");
    assert!(machine.input_commits.read("2").is_err());
}

#[test]
fn real_encoder_error_after_actual_main_commit_retains_publication_and_original_error() {
    let mut machine = machine();
    let message = bytes(&application(
        &machine,
        "group-b.insert-document-mention",
        r#"{"documentId":"inserted-document","documentName":"Document","blockName":"md"}"#,
    ))
    .expect("input");
    let previous_output = machine.output.clone();
    // Same incompatible-generation encoder seam as test/checklist_updates.rs,
    // injected only after the actual Session/Core entry has completed.
    machine.fail_next_output_generation = true;
    let error = machine
        .input_observed(&message, 2.0, 2.0, "1")
        .expect_err("real output encoder rejection");
    assert!(matches!(error, BoundaryError::Invalid("diff generation")));
    let receipt = machine.input_commits.read("1").expect("post-error receipt");
    assert_eq!(receipt.main_kind(), InputCommitKind::Published);
    assert_eq!(receipt.main_handled(), Some(true));
    assert!(receipt.commit_id().is_some());
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let view = session.surface().state().view();
    assert!(
        view.descendants(lexical_model::NodeKey::ROOT)
            .any(|(key, _)| {
                view.type_name(key)
                    .is_ok_and(|name| name == "document-mention")
                    && view.export_json(key).is_ok_and(|json| {
                        json.get("documentId").and_then(serde_json::Value::as_str)
                            == Some("inserted-document")
                    })
            }),
        "the actual committed document mention remains attached"
    );
    assert_eq!(
        machine.output, previous_output,
        "the encoder error does not fabricate flags or clear retained output"
    );
}

#[test]
fn observed_input_rejects_every_nonprogrammatic_family_field_before_model_mutation() {
    let mut machine = machine();
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor");
    };
    let before = session.surface().state().to_json().expect("model");
    for (index, (kind, keyboard, key, mods, code)) in [
        (0, false, "", 0, 0),
        (1, false, "", 0, 0),
        (3, false, "", 0, 0),
        (4, false, "", 0, 0),
        (2, true, "", 0, 0),
        (2, false, "Enter", 0, 0),
        (2, false, "", 1, 0),
        (2, false, "", 0, 13),
    ]
    .into_iter()
    .enumerate()
    {
        let mut message = application(&machine, "group-b.equation", r#"{"key":0,"equation":"x"}"#);
        message.kind = kind;
        if let wire::EditorInputMsg::EditorApplication {
            keyboard: actual_keyboard,
            key: actual_key,
            mods: actual_mods,
            code: actual_code,
            ..
        } = &mut message.editor
        {
            *actual_keyboard = keyboard;
            *actual_key = key.into();
            *actual_mods = mods;
            *actual_code = code;
        }
        let id = (index + 1).to_string();
        assert!(matches!(
            machine.input_observed(&bytes(&message).expect("input"), 3.0, 3.0, &id),
            Err(BoundaryError::Invalid(
                "observed programmatic application required"
            ))
        ));
        let receipt = machine
            .input_commits
            .read(&id)
            .expect("exact refused entry");
        assert_eq!(receipt.main_kind(), InputCommitKind::NotPublished);
        assert_eq!(receipt.main_handled(), None);
        let machine::Session::Editor(session) = &machine.session else {
            panic!("editor");
        };
        assert_eq!(session.surface().state().to_json().expect("model"), before);
    }
    let mut message = application(&machine, "group-b.equation", r#"{"key":0,"equation":"x"}"#);
    message.editor = wire::EditorInputMsg::EditorSetState {
        json: r#"{"root":{"type":"root","children":[]}}"#.into(),
    };
    assert!(matches!(
        machine.input_observed(&bytes(&message).expect("input"), 4.0, 4.0, "9"),
        Err(BoundaryError::Invalid(
            "observed programmatic application required"
        ))
    ));
    assert_eq!(
        machine
            .input_commits
            .read("9")
            .expect("nonapplication entry")
            .main_kind(),
        InputCommitKind::NotPublished
    );
}

#[test]
fn actual_read_queries_and_registration_metadata_preserve_historical_receipt() {
    let mut machine = machine();
    let message = bytes(&application(
        &machine,
        "group-b.equation",
        r#"{"key":0,"equation":"x"}"#,
    ))
    .expect("input");
    machine
        .input_observed(&message, 2.0, 2.0, "1")
        .expect("main");
    let expected = machine
        .input_commits
        .read("1")
        .expect("receipt")
        .commit_id();
    let mut session = EditorSession {
        machine,
        hostname: None,
        code_tokens: None,
    };
    session.serialized_state().expect("actual serializedState");
    session.saved_state().expect("actual savedState");
    session
        .query(
            &bytes(&wire::QueryMsg {
                kind: 3,
                key: 0,
                text: String::new(),
                flags: 0,
            })
            .expect("query"),
        )
        .expect("actual query");
    session.effective_access();
    let owner = session.view_command_owner().expect("actual owner metadata");
    assert_ne!(owner, 0);
    let enter = session
        .register_view_enter(7, 3)
        .expect("actual registration");
    let escape = session
        .register_view_escape(8, 3)
        .expect("actual registration");
    session
        .unregister_view_enter(enter)
        .expect("actual unregister");
    session
        .unregister_view_escape(escape)
        .expect("actual unregister");
    assert!(session
        .take_view_command_failure()
        .expect("actual failure metadata")
        .is_none());
    let receipt = session
        .machine
        .input_commits
        .read("1")
        .expect("unchanged historical outcome");
    assert_eq!(receipt.main_kind(), InputCommitKind::Published);
    assert_eq!(receipt.commit_id(), expected);
    assert_eq!(receipt.main_handled(), Some(false));
}

#[test]
fn database_result_belongs_to_the_observed_main_commit_and_survives_output_transfer() {
    let mut machine = machine();
    let start = bytes(&application(
        &machine,
        "group-b.database-create-start",
        "{}",
    ))
    .expect("database start");
    machine
        .input_observed(&start, 2.0, 2.0, "1")
        .expect("start");
    let started = machine.input_commits.read("1").expect("receipt");
    assert_eq!(started.database_kind().as_deref(), Some("started"));
    let key = started.database_key().expect("actual Await key");
    assert!(!started
        .database_await_id()
        .expect("actual Await id")
        .is_empty());
    machine.take_output().expect("output transfer");
    assert_eq!(
        machine
            .input_commits
            .read("1")
            .expect("receipt")
            .database_key(),
        Some(key)
    );
    let complete = bytes(&application(
        &machine,
        "group-b.database-create-complete",
        &format!(r#"{{"key":{key},"documentId":"fixture-database"}}"#),
    ))
    .expect("completion");
    machine
        .input_observed(&complete, 3.0, 3.0, "2")
        .expect("complete");
    let completed = machine.input_commits.read("2").expect("receipt");
    assert_eq!(completed.database_kind().as_deref(), Some("inserted"));
    assert_eq!(completed.database_key(), None);
    assert!(machine.input_commits.read("1").is_err());
    let noop = bytes(&application(
        &machine,
        "group-b.equation",
        r#"{"key":0,"equation":"x"}"#,
    ))
    .expect("unrelated");
    machine
        .input_observed(&noop, 4.0, 4.0, "3")
        .expect("unrelated");
    assert_eq!(
        machine
            .input_commits
            .read("3")
            .expect("receipt")
            .database_kind(),
        None
    );
    assert_eq!(started.database_kind().as_deref(), Some("started"));
}

#[test]
fn database_start_receipt_survives_an_output_encoder_error_after_publication() {
    let mut machine = machine();
    let start = bytes(&application(
        &machine,
        "group-b.database-create-start",
        "{}",
    ))
    .expect("database start");
    machine.fail_next_output_generation = true;
    assert!(matches!(
        machine.input_observed(&start, 2.0, 2.0, "1"),
        Err(BoundaryError::Invalid("diff generation"))
    ));
    let receipt = machine.input_commits.read("1").expect("committed receipt");
    assert_eq!(receipt.main_kind(), InputCommitKind::Published);
    assert_eq!(receipt.database_kind().as_deref(), Some("started"));
    assert!(receipt.database_key().is_some());
    assert!(receipt.database_await_id().is_some());
}
