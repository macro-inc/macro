use super::*;
use connection_gateway_models::fanout::ConnId;

fn gateway(id: &str) -> GatewayId {
    GatewayId(id.into())
}

#[test]
fn text_frames_are_filtered_but_still_mark_liveness() {
    let mut liveness = HashMap::new();
    let event = translate(
        FromGateway::Frame {
            gateway: gateway("g1"),
            conn: ConnId("c1".into()),
            text: true,
            payload: b"{}".to_vec(),
        },
        &mut liveness,
    );
    assert!(event.is_none());
    assert!(liveness.contains_key(&gateway("g1")));
}

#[test]
fn binary_frames_become_edge_frames() {
    let mut liveness = HashMap::new();
    let event = translate(
        FromGateway::Frame {
            gateway: gateway("g1"),
            conn: ConnId("c1".into()),
            text: false,
            payload: vec![1, 2],
        },
        &mut liveness,
    );
    match event {
        Some(Event::Edge(EdgeEvent::Frame { conn, payload })) => {
            assert_eq!(conn.gateway, gateway("g1"));
            assert_eq!(conn.conn, ConnId("c1".into()));
            assert_eq!(payload, vec![1, 2]);
        }
        other => panic!("wrong event: {other:?}"),
    }
}

#[test]
fn heartbeats_and_connected_mark_liveness_without_events() {
    let mut liveness = HashMap::new();
    assert!(
        translate(
            FromGateway::Heartbeat {
                gateway: gateway("g1")
            },
            &mut liveness
        )
        .is_none()
    );
    assert!(liveness.contains_key(&gateway("g1")));
}

#[test]
fn disconnected_becomes_an_edge_event() {
    let mut liveness = HashMap::new();
    let event = translate(
        FromGateway::Disconnected {
            gateway: gateway("g1"),
            conn: ConnId("c1".into()),
        },
        &mut liveness,
    );
    assert!(matches!(
        event,
        Some(Event::Edge(EdgeEvent::Disconnected { .. }))
    ));
}
