use super::MessageWithConnection;
use crate::model::message::{Message, TraceCarrier};
use redis::{FromRedisValue as _, Value};

#[test]
fn redis_round_trip_preserves_trace_carrier() {
    let original = MessageWithConnection {
        message: Message {
            message_type: "refresh".into(),
            data: "{}".into(),
            trace: TraceCarrier {
                traceparent: Some("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01".into()),
                tracestate: Some("vendor=value".into()),
            },
        },
        connection_id: "connection-1".into(),
    };
    let encoded = serde_json::to_vec(&original).unwrap();
    let decoded = MessageWithConnection::from_redis_value(Value::BulkString(encoded)).unwrap();

    assert_eq!(decoded.connection_id, original.connection_id);
    assert_eq!(decoded.message.message_type, original.message.message_type);
    assert_eq!(decoded.message.data, original.message.data);
    assert_eq!(decoded.message.trace, original.message.trace);
}
