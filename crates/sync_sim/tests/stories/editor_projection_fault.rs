use super::*;

#[test]
fn faulty_projection_writes_close_peers_at_the_reset_budget_then_reopen() {
    let mut config = SimConfig::editor(821);
    config.session.reset_budget = doc_sync_core::ResetBudget {
        max: 2,
        window: doc_sync_core::Millis(60_000),
    };
    config
        .faulty_editor_clients
        .insert(ClientName("faulty".into()));
    let trace = std::sync::Arc::new(std::sync::Mutex::new((0usize, 0usize)));
    let subscriber = FaultTrace(trace.clone());
    let _guard = tracing::subscriber::set_default(subscriber);
    let script = vec![
        Step::Open(OpenSpec::form("faulty", "one")),
        Step::Open(OpenSpec::form("reader", "two")),
        Step::Settle,
        Step::Edit {
            client: ClientName("faulty".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "first🦀".into(),
            }),
        },
        Step::Run(Millis(12_000)),
        Step::Edit {
            client: ClientName("faulty".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "second".into(),
            }),
        },
        Step::Run(Millis(12_000)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("reader".into()),
            count: 32,
        }),
        Step::Edit {
            client: ClientName("reader".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "retained🦀".into(),
            }),
        },
        Step::Edit {
            client: ClientName("faulty".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "third".into(),
            }),
        },
        Step::Run(Millis(12_000)),
        Step::Close {
            client: ClientName("faulty".into()),
        },
        Step::Crash {
            client: ClientName("reader".into()),
        },
        Step::Reopen {
            client: ClientName("faulty".into()),
        },
        Step::Reopen {
            client: ClientName("reader".into()),
        },
        Step::Settle,
    ];
    let prefix = Sim::new(config.clone()).run(&script[..11]);
    let pending = &prefix.finals.clients[&ClientName("reader".into())];
    assert_eq!(pending.terminal.as_deref(), Some("Corrupt"));
    assert!(pending.wal_total > 0);
    assert!(
        prefix.finals.profiles[&ProfileName("two".into())]
            .entries
            .values()
            .any(|row| !row.delivered && !row.record.quarantined)
    );
    *trace.lock().unwrap() = (0, 0);
    let outcome = Sim::new(config).run(&script);
    assert_eq!(
        outcome.finals.clients[&ClientName("reader".into())].wal_total,
        0
    );
    assert!(
        outcome.finals.servers[&DocIx(0)]
            .deep_value
            .to_string()
            .contains("retained🦀")
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::Status { client, status } if client.0 == "reader" && matches!(status.connection, doc_sync_core::ConnectionStatus::Closed(doc_sync_core::CloseReason::Corrupt)))), "observations: {:#?}", outcome.events.iter().filter(|event| matches!(&event.fact, Fact::ProjectionFaultWrite { .. } | Fact::Imported { .. } | Fact::Status { .. })).collect::<Vec<_>>());
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(&event.fact, Fact::ProjectionFaultWrite { .. }))
            .count(),
        3
    );
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}\n{}", outcome.failure_report());
    }
    assert_eq!(
        *trace.lock().unwrap(),
        (3, 3),
        "one visible injection error and tracing span per fault"
    );
    assert_eq!(outcome.events.iter().filter(|event| matches!(&event.fact, Fact::ProjectionRecovered { client, error, spans, .. } if client.0 == "reader" && !error.is_empty() && !spans.is_empty())).count(), 3);
    outcome.check_replay().unwrap();
    let mut missing_receipt = outcome.clone();
    missing_receipt
        .events
        .retain(|event| !matches!(event.fact, Fact::ProjectionFaultWrite { .. }));
    assert!(invariants::no_spurious_terminal(&missing_receipt).is_err());
    assert!(invariants::projection_recovery_visible(&missing_receipt).is_err());
    let mut unrelated = outcome.clone();
    for event in &mut unrelated.events {
        if let Fact::ProjectionRecovered { spans, .. } = &mut event.fact {
            spans.clear();
        }
    }
    assert!(invariants::projection_recovery_visible(&unrelated).is_err());
    let mut reopened = outcome.clone();
    reopened
        .finals
        .clients
        .get_mut(&ClientName("faulty".into()))
        .unwrap()
        .editor
        .as_mut()
        .unwrap()
        .synced_json = serde_json::json!({"invalid":true});
    assert!(
        invariants::projection_consistent(&reopened).is_err(),
        "a new incarnation inherits no fault exemption"
    );
}

// The actual tracing API verifies fault visibility, independently of core telemetry facts.
struct FaultTrace(std::sync::Arc<std::sync::Mutex<(usize, usize)>>);
impl tracing::Subscriber for FaultTrace {
    fn register_callsite(
        &self,
        _: &'static tracing::Metadata<'static>,
    ) -> tracing::subscriber::Interest {
        tracing::subscriber::Interest::sometimes()
    }
    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        Some(tracing::level_filters::LevelFilter::TRACE)
    }
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        metadata.target() == "document_session::test_faults"
    }
    fn new_span(&self, attributes: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        let mut observed = self.0.lock().unwrap();
        assert_eq!(attributes.metadata().name(), "doc.projection.inject");
        observed.0 += 1;
        tracing::span::Id::from_u64(observed.0 as u64)
    }
    fn event(&self, event: &tracing::Event<'_>) {
        if *event.metadata().level() == tracing::Level::ERROR {
            self.0.lock().unwrap().1 += 1;
        }
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

#[test]
fn projection_exemption_needs_an_actual_fault_in_the_exact_incarnation() {
    let mut config = SimConfig::editor(823);
    config
        .faulty_editor_clients
        .insert(ClientName("faulty".into()));
    let prefix = [
        Step::Open(OpenSpec::form("faulty", "one")),
        Step::Open(OpenSpec::form("healthy", "two")),
        Step::Settle,
    ];
    let before = Sim::new(config.clone()).run(&prefix);
    let mut corrupt = before.clone();
    corrupt
        .finals
        .clients
        .get_mut(&ClientName("faulty".into()))
        .unwrap()
        .editor
        .as_mut()
        .unwrap()
        .synced_json = serde_json::json!({"wrong":true});
    assert!(
        invariants::projection_consistent(&corrupt).is_err(),
        "arming a client does not exempt its model"
    );
    let mut script = prefix.to_vec();
    script.push(Step::Edit {
        client: ClientName("faulty".into()),
        op: AbstractOp::Editor(EditorOp::Type {
            at: Pos::default(),
            text: "fault".into(),
        }),
    });
    let after = Sim::new(config).run(&script);
    assert!(invariants::projection_consistent(&after).is_ok());
    let writer = &after.finals.clients[&ClientName("faulty".into())]
        .editor
        .as_ref()
        .unwrap();
    assert_ne!(
        writer.synced_json, writer.reconstructed,
        "the injected own projection is actually inconsistent"
    );
    let mut healthy = after.clone();
    healthy
        .finals
        .clients
        .get_mut(&ClientName("healthy".into()))
        .unwrap()
        .editor
        .as_mut()
        .unwrap()
        .synced_json = serde_json::json!({"wrong":true});
    assert!(invariants::projection_consistent(&healthy).is_err());
    let mut wrong_generation = after.clone();
    let previous = before.finals.clients[&ClientName("healthy".into())].session;
    for event in &mut wrong_generation.events {
        if let Fact::ProjectionFaultWrite { session, .. } = &mut event.fact {
            *session = previous;
        }
    }
    assert!(invariants::projection_consistent(&wrong_generation).is_err());
    let mut wrong_document = after.clone();
    for event in &mut wrong_document.events {
        if let Fact::ProjectionFaultWrite { doc, .. } = &mut event.fact {
            *doc = DocIx(99);
        }
    }
    assert!(invariants::projection_consistent(&wrong_document).is_err());
    assert!(
        invariants::editor_states_equal(&after).is_err(),
        "convergence is never exempted for faulty clients"
    );
    after.check_replay().unwrap();
}
