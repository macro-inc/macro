use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::RequestId;
use serde_json::json;

use super::*;

#[test]
fn event_names_are_opaque_wire_strings() {
    let event_names = [
        SystemEvent::Unknown("runtime/ready".to_owned()),
        SystemEvent::Unknown("agent/started".to_owned()),
        SystemEvent::Unknown("vendor/custom-event".to_owned()),
    ];
    for name in event_names {
        let wire_name = name.as_str();
        assert_eq!(serde_json::to_value(&name).unwrap(), json!(wire_name));
        assert_eq!(
            serde_json::from_value::<SystemEvent>(json!(wire_name)).unwrap(),
            name
        );
    }
}

#[test]
fn acp_ready_round_trips_as_a_typed_variant() {
    assert_eq!(serde_json::to_value(SystemEvent::AcpReady).unwrap(), json!("acp_ready"));
    assert_eq!(
        serde_json::from_value::<SystemEvent>(json!("acp_ready")).unwrap(),
        SystemEvent::AcpReady
    );
}

#[test]
fn unknown_event_names_round_trip_losslessly() {
    let event = serde_json::from_value::<SystemEvent>(json!("vendor/custom-event")).unwrap();
    assert_eq!(
        event,
        SystemEvent::Unknown("vendor/custom-event".to_owned())
    );
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!("vendor/custom-event")
    );
}

#[test]
fn to_server_message_event_has_the_specified_wire_shape() {
    let event = ToServerMessage::Event {
        event: SystemEvent::Unknown("agent/stopped".to_owned()),
    };

    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({
            "type": "event",
            "event": "agent/stopped",
        })
    );
}

#[test]
fn acp_message_contains_an_acp_raw_jsonrpc_message() {
    let nested = RawJsonRpcMessage::request(
        "initialize".to_owned(),
        json!({ "protocolVersion": 1 }),
        RequestId::Number(1),
    )
    .unwrap();
    let delivery = ToRuntimeMessage::Acp(AcpMessage(nested));

    let message = serde_json::to_value(delivery).unwrap();
    assert_eq!(
        message,
        json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
            },
        })
    );

    let ToRuntimeMessage::Acp(AcpMessage(parsed)) =
        serde_json::from_value::<ToRuntimeMessage>(message).unwrap();
    assert_eq!(
        serde_json::to_value(parsed).unwrap(),
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
            },
        })
    );
}
