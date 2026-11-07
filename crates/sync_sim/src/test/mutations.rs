use super::*;

fn baseline() -> Outcome {
    verify(
        SimConfig::calm(61),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Select(Some(1)),
            },
            Step::Settle,
        ],
    )
}
#[test]
fn durability_queries_reject_a_missing_cold_server_operation() {
    let mut outcome = baseline();
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_acked_edit_lost(&outcome).is_err());
    assert!(invariants::no_persisted_edit_lost(&outcome).is_err());
    assert!(invariants::no_edit_lost_without_crash(&outcome).is_err());
}
#[test]
fn ack_query_requires_successful_put_evidence_for_every_range() {
    let mut outcome = baseline();
    outcome
        .events
        .retain(|event| !matches!(event.fact, Fact::PendingStored { .. }));
    assert!(invariants::core_acks_after_writes(&outcome).is_err());
    let mut outcome = baseline();
    for event in &mut outcome.events {
        if let Fact::PendingStored { spans, .. } = &mut event.fact {
            spans.clear();
        }
    }
    assert!(invariants::core_acks_after_writes(&outcome).is_err());
}
#[test]
fn gate_query_rejects_an_ack_without_its_durable_callback() {
    let mut outcome = baseline();
    outcome
        .events
        .retain(|event| !matches!(event.fact, Fact::ServerDurable { .. }));
    assert!(invariants::gate_releases_after_durable(&outcome).is_err());
}
#[test]
fn convergence_pending_quiet_and_presence_queries_reject_damaged_observations() {
    let mut outcome = baseline();
    outcome
        .finals
        .clients
        .get_mut(&ClientName("b".into()))
        .unwrap()
        .oplog_vv
        .clear();
    assert!(invariants::all_docs_equal(&outcome).is_err());
    assert!(invariants::quiet(&outcome).is_err());
    let mut outcome = baseline();
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .pending_import = true;
    assert!(invariants::no_dependency_stuck(&outcome).is_err());
    let mut outcome = baseline();
    outcome
        .finals
        .presence
        .as_mut()
        .unwrap()
        .get_mut(&ClientName("b".into()))
        .unwrap()
        .clear();
    assert!(invariants::presence_converged(&outcome).is_err());
}
#[test]
fn comment_and_undo_queries_reject_false_claims_without_editor_adapters() {
    let mut outcome = baseline();
    let at = outcome.events.last().unwrap().at;
    let client = ClientName("a".into());
    let spans = vec![IdSpan {
        peer: 999_999,
        start: 0,
        end: 1,
    }];
    outcome.events.push(Event {
        at,
        fact: Fact::CommentSent {
            client: client.clone(),
            request: 51,
            mark_id: "mark".into(),
            update: "comment".into(),
            spans: spans.clone(),
        },
    });
    outcome.events.push(Event {
        at,
        fact: Fact::CommentReplied {
            client: client.clone(),
            request: 51,
            reply: CommentResult::Accepted,
        },
    });
    assert!(invariants::comment_replies_truthful(&outcome).is_err());
    outcome.events.push(Event {
        at,
        fact: Fact::UndoApplied {
            client,
            removed: spans,
        },
    });
    assert!(invariants::undo_reverts_only_own(&outcome).is_err());
    assert!(invariants::editor_states_equal(&outcome).is_err());
    assert!(invariants::projection_consistent(&outcome).is_err());
}
#[test]
fn unrelated_parked_row_does_not_exempt_a_lost_edit() {
    let mut outcome = baseline();
    let client = outcome
        .finals
        .clients
        .get_mut(&ClientName("a".into()))
        .unwrap();
    client.access = Access::Read;
    client
        .parked
        .push((doc_sync_core::WalSeq(999), "ReadOnly".into()));
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_edit_lost_without_crash(&outcome).is_err());
}

#[test]
fn same_timestamp_future_open_cannot_reassign_an_earlier_local_operation() {
    let mut outcome = baseline();
    let index = outcome
        .events
        .iter()
        .position(|event| matches!(event.fact, Fact::LocalOp { .. }))
        .unwrap();
    let mut later = outcome
        .events
        .iter()
        .find(|event| matches!(&event.fact, Fact::Opened { client, .. } if client.0 == "a"))
        .unwrap()
        .clone();
    later.at = outcome.events[index].at;
    if let Fact::Opened { doc, .. } = &mut later.fact {
        *doc = DocIx(1);
    }
    outcome.events.insert(index + 1, later);
    let server = outcome.finals.servers[&DocIx(0)].clone();
    outcome.finals.servers.insert(DocIx(1), server);
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_edit_lost_without_crash(&outcome).is_err());
}

#[test]
fn a_previous_session_crash_does_not_exempt_later_session_edits() {
    let mut outcome = baseline();
    outcome.events.insert(
        0,
        Event {
            at: Millis(0),
            fact: Fact::Crashed {
                client: ClientName("a".into()),
            },
        },
    );
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(invariants::no_edit_lost_without_crash(&outcome).is_err());
}

#[test]
fn hostile_registry_skips_liveness_but_keeps_durable_ack_safety() {
    let mut outcome = baseline();
    outcome.config.net.hostile = Some(Hostile::default());
    outcome
        .events
        .retain(|event| !matches!(event.fact, Fact::Settled));
    outcome.quiet_events.push(Event {
        at: Millis(99_999),
        fact: Fact::SocketClose {
            client: ClientName("a".into()),
            connection: 1,
            code: 1000,
            reason: "ProtocolError".into(),
        },
    });
    assert!(invariants::settled(&outcome).is_err());
    assert!(invariants::quiet(&outcome).is_err());
    invariants::check_all(&outcome).unwrap();
    outcome
        .finals
        .servers
        .get_mut(&DocIx(0))
        .unwrap()
        .persisted_vv
        .clear();
    assert!(
        invariants::check_all(&outcome)
            .unwrap_err()
            .iter()
            .any(|failure| failure.invariant == "no_acked_edit_lost")
    );
}
