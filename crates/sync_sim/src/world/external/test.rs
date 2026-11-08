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
