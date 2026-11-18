use super::*;

#[test]
fn setup_refuses_busy_room_without_mutating_socket_membership() {
    let mut sim = Sim::new(SimConfig::calm(227));
    sim.servers[&DocIx(0)]
        .ports
        .set_latency("connections.accept", std::time::Duration::from_millis(100));
    sim.register_external(OpenSpec::form("first", "one"))
        .unwrap();
    sim.connect_external(&ClientName("first".into())).unwrap();
    sim.register_external(OpenSpec::form("second", "two"))
        .unwrap();
    let before = sim.net.links.len();
    let error = sim
        .connect_external(&ClientName("second".into()))
        .unwrap_err();
    assert_eq!(error.invariant, "external_connect_busy");
    assert_eq!(sim.net.links.len(), before);
    sim.apply_step(Step::Run(Millis(200))).unwrap();
    sim.connect_external(&ClientName("second".into())).unwrap();
    sim.apply_step(Step::Run(Millis(200))).unwrap();
    assert_eq!(
        sim.connect_external(&ClientName("first".into()))
            .unwrap_err()
            .invariant,
        "external_connect_duplicate"
    );
    assert_eq!(sim.net.links.len(), before + 1);
}

#[test]
fn rotating_foreign_authorship_requires_observed_ranges_not_imported_vv_growth() {
    let mut sim = Sim::new(SimConfig::editor(769));
    let name = ClientName("worker".into());
    sim.register_external(OpenSpec::form("worker", "one"))
        .unwrap();
    let imported = 11;
    let rotated = 0xa1a1_a100_0000_0001;
    let vv = Vv::from([(imported, 90), (rotated, 7)]);
    let before = sim.events.len();
    assert_eq!(
        sim.external_authored(
            &name,
            vv.clone(),
            vec![IdSpan {
                peer: rotated,
                start: 4,
                end: 8
            }],
        )
        .unwrap_err()
        .invariant,
        "external_commit"
    );
    assert!(sim.external[&name].vv.is_empty());
    assert_eq!(sim.events.len(), before);
    sim.external_authored(
        &name,
        vv.clone(),
        vec![IdSpan {
            peer: rotated,
            start: 4,
            end: 7,
        }],
    )
    .unwrap();
    let Fact::ExternalCommit { spans, doc, .. } = &sim.events.last().unwrap().fact else {
        panic!("actual authored ranges");
    };
    assert_eq!(*doc, DocIx(0));
    assert_eq!(
        spans,
        &[IdSpan {
            peer: rotated,
            start: 4,
            end: 7
        }]
    );
    assert_eq!(sim.external[&name].vv, vv);
    let after = sim.events.len();
    sim.external_authored(&name, Vv::from([(imported, 100), (rotated, 7)]), vec![])
        .unwrap();
    assert_eq!(
        sim.events.len(),
        after,
        "imported history is not local authorship"
    );
}
